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

	getQueue(): Track[] {
		return [...this.queue];
	}

	getPrevious(): Track | null {
		return this.history[this.history.length - 1] ?? null;
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
			const stream = this.resolver.createPcmStream(track);
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
