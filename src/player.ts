import { EventEmitter } from 'node:events';
import type {
	AudioDispatcher,
	Client,
	Message,
	VoiceChannel,
	VoiceConnection,
} from 'discord.js-selfbot-v13';
import type { Resolver, Track } from './resolver';

export type LoopMode = 'off' | 'track' | 'queue';

/**
 * Escalating audio filter presets. Each step stacks more ffmpeg compression
 * and gain on top of the previous one, so the output gets progressively
 * louder and punchier.
 *
 * Discord applies its own normalisation to the mixed voice stream, so the
 * filters work by reducing dynamic range (compression) and boosting the
 * signal floor, which makes playback perceptibly louder for listeners.
 */
export interface PumpStep {
	name: string;
	description: string;
	/**
	 * ffmpeg audio filter chain applied to the PCM stream.
	 */
	filters: string;
	/**
	 * Suggested playback volume (0-1) for this step.
	 */
	volume: number;
}

export const PUMP_LEVELS: PumpStep[] = [
	{ name: 'off', description: 'Normal playback.', filters: '', volume: 0.5 },
	{
		name: 'loud',
		description: 'Light compression + gain.',
		filters: 'acompressor=threshold=-18dB:ratio=2:attack=20:release=200,volume=3dB',
		volume: 0.7,
	},
	{
		name: 'louder',
		description: 'Stronger compression, more gain.',
		filters: 'acompressor=threshold=-14dB:ratio=3:attack=10:release=150,volume=6dB',
		volume: 0.9,
	},
	{
		name: 'loudest',
		description: 'Heavy compression and boost.',
		filters: 'acompressor=threshold=-10dB:ratio=4:attack=5:release=120,volume=9dB',
		volume: 1.0,
	},
	{
		name: 'max',
		description: 'Near-limiter compression, hard boost.',
		filters:
			'acompressor=threshold=-8dB:ratio=6:attack=3:release=100,volume=12dB,alimiter=limit=0.97',
		volume: 1.0,
	},
	{
		name: 'insane',
		description: 'Brickwall compression + limiter slam.',
		filters:
			'acompressor=threshold=-6dB:ratio=9:attack=2:release=80,volume=15dB,alimiter=limit=0.99:level=disabled',
		volume: 1.0,
	},
	{
		name: 'headphone-killer',
		description: 'Maximum loudness. Ear protection strongly advised.',
		filters:
			'acompressor=threshold=-4dB:ratio=12:attack=1:release=60,volume=18dB,alimiter=limit=1:level=disabled',
		volume: 1.0,
	},
];

export interface PlayerEvents {
	start: (track: Track) => void;
	finish: (track: Track) => void;
	empty: () => void;
	error: (error: Error) => void;
}

export class GuildPlayer extends EventEmitter {
	readonly client: Client;
	readonly resolver: Resolver;
	private queue: Track[] = [];
	private history: Track[] = [];
	private current: Track | null = null;
	private connection: VoiceConnection | null = null;
	private channel: VoiceChannel | null = null;
	private dispatcher: AudioDispatcher | null = null;
	private volume = 0.5;
	private loop: LoopMode = 'off';
	private pumpLevel = 0;

	constructor(client: Client, resolver: Resolver) {
		super();
		this.client = client;
		this.resolver = resolver;
	}

	get playing(): boolean {
		return this.current != null;
	}

	get track(): Track | null {
		return this.current;
	}

	get loopMode(): LoopMode {
		return this.loop;
	}

	getVolume(): number {
		return this.volume;
	}

	setVolume(value: number): void {
		this.volume = Math.min(1, Math.max(0, value));
		this.dispatcher?.setVolume(this.volume);
	}

	getPumpLevel(): number {
		return this.pumpLevel;
	}

	getPump(): PumpStep {
		return PUMP_LEVELS[this.pumpLevel];
	}

	/**
	 * Set the loudness preset and restart the current track so the ffmpeg
	 * filter chain is applied.
	 */
	setPumpLevel(level: number, message: Message): void {
		this.pumpLevel = Math.min(
			PUMP_LEVELS.length - 1,
			Math.max(0, Math.floor(level)),
		);
		this.volume = this.getPump().volume;
		if (this.playing) {
			this.replayCurrent(message);
		}
	}

	private replayCurrent(message: Message): void {
		const current = this.current;
		if (!current) return;
		this.queue.unshift(current);
		this.current = null;
		this.dispatcher?.end?.();
		void message;
	}

	getQueue(): Track[] {
		return [...this.queue];
	}

	getPrevious(): Track | null {
		return this.history[this.history.length - 1] ?? null;
	}

	shuffleQueue(): void {
		for (let i = this.queue.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
		}
	}

	setLoop(mode: LoopMode): void {
		this.loop = mode;
	}

	get voiceChannelId(): string | null {
		return this.channel?.id ?? null;
	}

	async connect(channel: VoiceChannel): Promise<void> {
		if (this.connection && this.channel?.id !== channel.id) {
			this.dispatcher?.destroy?.();
			this.connection.disconnect();
			this.connection = null;
		}
		this.channel = channel;
		if (!this.connection) {
			this.connection = await this.client.voice.joinChannel(channel);
			this.connection.on('disconnect', () => {
				this.connection = null;
				this.dispatcher = null;
				this.current = null;
			});
			this.connection.on('error', (err) =>
				this.emit('error', err instanceof Error ? err : new Error(String(err))),
			);
		}
	}

	async enqueue(track: Track, message: Message): Promise<void> {
		this.queue.push(track);
		if (!this.playing) {
			await this.playNext(message);
		}
	}

	private async playNext(message: Message): Promise<void> {
		const track = this.queue.shift();
		if (!track) {
			this.current = null;
			this.emit('empty');
			return;
		}
		try {
			const stream = this.resolver.createPcmStream(
				track,
				this.getPump().filters,
			);
			const dispatcher = this.connection!.playAudio(stream, {
				type: 'converted',
				volume: this.volume,
			});
			this.dispatcher = dispatcher;
			this.current = track;
			this.emit('start', track);

			dispatcher.once('finish', () => this.handleFinished(message));
			dispatcher.once('error', (error: Error) => {
				this.emit('error', error);
				this.handleFinished(message);
			});
		} catch (error) {
			this.emit(
				'error',
				error instanceof Error ? error : new Error(String(error)),
			);
			this.handleFinished(message);
		}
	}

	private async handleFinished(message: Message): Promise<void> {
		const finished = this.current;
		if (finished) {
			this.history.push(finished);
			this.emit('finish', finished);
			if (this.loop === 'track') {
				this.queue.unshift(finished);
			} else if (this.loop === 'queue') {
				this.queue.push(finished);
			}
		}
		await this.playNext(message);
	}

	skip(message: Message): void {
		if (!this.playing) return;
		this.loop = this.loop === 'track' ? 'off' : this.loop;
		this.dispatcher?.end?.();
		void message;
	}

	pause(): boolean {
		if (!this.dispatcher || this.dispatcher.paused) return false;
		this.dispatcher.pause();
		return true;
	}

	resume(): boolean {
		if (!this.dispatcher || !this.dispatcher.paused) return false;
		this.dispatcher.resume();
		return true;
	}

	stop(): void {
		this.queue = [];
		this.loop = 'off';
		this.dispatcher?.end?.();
	}

	leave(): void {
		this.queue = [];
		this.current = null;
		this.dispatcher?.end?.();
		this.dispatcher = null;
		this.connection?.disconnect();
		this.connection = null;
		this.channel = null;
	}
}
