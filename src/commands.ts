import type { Message } from 'discord.js-selfbot-v13';
import { GuildPlayer, type LoopMode } from './player';
import type { Resolver } from './resolver';

export const PREFIX = '!';

export interface CommandContext {
	message: Message;
	player: GuildPlayer;
	resolver: Resolver;
	send: (content: string) => Promise<unknown>;
}

type Command = (ctx: CommandContext, args: string[]) => Promise<unknown>;

function formatDuration(seconds?: number): string {
	if (!seconds || seconds <= 0) return 'live';
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

const play: Command = async ({ message, player, resolver, send }, args) => {
	const query = args.join(' ').trim();
	if (!query) {
		return send('Usage: `!play <file.mp3|youtube url|song name|spotify link>`');
	}
	const voiceChannel = message.member?.voice?.channel;
	if (!voiceChannel) {
		return send('You need to join a voice channel first.');
	}
	if (player.voiceChannelId && player.voiceChannelId !== voiceChannel.id) {
		return send(
			`I'm already playing in <#${player.voiceChannelId}>. Join me or use \`!leave\` first.`,
		);
	}
	await player.connect(voiceChannel as any);

	let track;
	try {
		await send(`Searching for \`${query}\`...`);
		track = await resolver.resolve(query);
	} catch (error) {
		return send(`Could not resolve track: ${(error as Error).message}`);
	}

	if (player.playing) {
		await player.enqueue(track, message);
		return send(
			`Queued **${track.title}** (${track.source}) \u2022 position #${player.getQueue().length}`,
		);
	}
	await player.enqueue(track, message);
	return send(`Now playing **${track.title}** (${track.source})`);
};

const skip: Command = async ({ player, send }) => {
	if (!player.playing) return send('Nothing is playing.');
	player.skip({} as Message);
	return send('Skipped \u23ed\ufe0f');
};

const pause: Command = async ({ player, send }) => {
	if (!player.playing) return send('Nothing is playing.');
	return send(player.pause() ? 'Paused \u23f8\ufe0f' : 'Already paused.');
};

const resume: Command = async ({ player, send }) => {
	if (!player.playing) return send('Nothing is playing.');
	return send(player.resume() ? 'Resumed \u25b6\ufe0f' : 'Already playing.');
};

const stop: Command = async ({ player, send }) => {
	player.stop();
	return send('Stopped and cleared the queue.');
};

const leave: Command = async ({ player, send }) => {
	player.leave();
	return send('Left the voice channel.');
};

const volume: Command = async ({ player, send }, args) => {
	const value = Number(args[0]);
	if (Number.isNaN(value) || value < 0 || value > 100) {
		return send(`Current volume: **${Math.round(player.getVolume() * 100)}%**. Use \`!volume <0-100>\`.`);
	}
	player.setVolume(value / 100);
	return send(`Volume set to **${value}%**.`);
};

const queue: Command = async ({ player, send }) => {
	const current = player.track;
	const upcoming = player.getQueue();
	const lines: string[] = [];
	if (current) {
		lines.push(`\u25b6\ufe0f **${current.title}** (${current.source})`);
	}
	upcoming.forEach((track, index) => {
		lines.push(`${index + 1}. ${track.title} (${formatDuration(track.duration)})`);
	});
	if (lines.length === 0) {
		return send('The queue is empty.');
	}
	return send(`\u{1f3b5} Queue\n${lines.join('\n')}`);
};

const loop: Command = async ({ player, send }, args) => {
	const modes: LoopMode[] = ['off', 'track', 'queue'];
	const requested = (args[0]?.toLowerCase() as LoopMode) ?? undefined;
	if (!requested || !modes.includes(requested)) {
		const next = modes[(modes.indexOf(player.loopMode) + 1) % modes.length];
		player.setLoop(next);
		return send(`Loop mode: **${next}**`);
	}
	player.setLoop(requested);
	return send(`Loop mode: **${requested}**`);
};

const nowplaying: Command = async ({ player, send }) => {
	const track = player.track;
	if (!track) return send('Nothing is playing.');
	return send(
		`Now playing **${track.title}**\nSource: \`${track.source}\` \u2022 Duration: ${formatDuration(
			track.duration,
		)} \u2022 Volume: ${Math.round(player.getVolume() * 100)}%`,
	);
};

const help: Command = async ({ send }) => {
	return send(
		[
			'\u{1f3b5} **Music commands**',
			'`!play <query>` \u2014 local mp3/mp4, YouTube URL/search, Spotify link',
			'`!pause` / `!resume`',
			'`!skip`',
			'`!stop`',
			'`!queue`',
			'`!nowplaying`',
			'`!volume <0-100>`',
			'`!loop [off|track|queue]`',
			'`!leave`',
		].join('\n'),
	);
};

const commands: Record<string, Command> = {
	play: play,
	p: play,
	skip: skip,
	pause: pause,
	resume: resume,
	stop: stop,
	leave: leave,
	disconnect: leave,
	volume: volume,
	vol: volume,
	queue: queue,
	q: queue,
	loop: loop,
	nowplaying: nowplaying,
	np: nowplaying,
	help: help,
	commands: help,
};

export async function handleCommand(
	message: Message,
	player: GuildPlayer,
	resolver: Resolver,
	selfId: string,
): Promise<void> {
	if (message.author?.id !== selfId) return;
	const content = message.content?.trim() ?? '';
	if (!content.startsWith(PREFIX)) return;

	const [rawName, ...args] = content.slice(PREFIX.length).trim().split(/\s+/);
	const command = commands[rawName?.toLowerCase()];
	if (!command) return;

	const send = (text: string) => message.channel.send(text);
	try {
		await command({ message, player, resolver, send }, args);
	} catch (error) {
		console.error(`Command "${rawName}" failed:`, error);
		await send(`Error: ${(error as Error).message}`).catch(() => {});
	}
}
