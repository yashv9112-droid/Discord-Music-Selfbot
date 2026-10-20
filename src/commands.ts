import type { Message } from 'discord.js-selfbot-v13';
import {
	GuildPlayer,
	PUMP_LEVELS,
	type LoopMode,
} from './player';
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

const playfile: Command = async ({ message, player, resolver, send }, args) => {
	const query = args.join(' ').trim();
	if (!query) {
		return send(
			"Usage: `!playfile <path|filename>` \u2014 e.g. `!playfile song.mp3`. Run `!files` to list what's available.",
		);
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
		track = resolver.resolveLocal(query);
	} catch (error) {
		return send((error as Error).message);
	}

	if (player.playing) {
		await player.enqueue(track, message);
		return send(
			`Queued file **${track.title}** \u2022 position #${player.getQueue().length}`,
		);
	}
	await player.enqueue(track, message);
	return send(
		`Now playing local file **${track.title}** (${formatDuration(track.duration)})`,
	);
};

const files: Command = async ({ resolver, send }, args) => {
	const all = resolver.listLocalFiles();
	if (all.length === 0) {
		return send(
			`No local files found. Drop mp3/mp4 files into \`${resolver.musicDir()}\` then run \`!files\` again.`,
		);
	}
	const page = Math.max(1, Number(args[0]) || 1);
	const perPage = 15;
	const pages = Math.ceil(all.length / perPage);
	const current = Math.min(page, pages);
	const slice = all.slice((current - 1) * perPage, current * perPage);
	const lines = slice.map((file, index) => {
		const name = file.split(/[\\/]/).pop();
		return `\`${(current - 1) * perPage + index + 1}\`. ${name}`;
	});
	return send(
		`\u{1f4c1} **Local files** (${all.length}) \u2014 page ${current}/${pages}\n${lines.join('\n')}\nPlay one with \`!playfile <name>\` or \`!play <name>\`.`,
	);
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
			'`!playfile <path|name>` \u2014 play a local mp3/mp4 (checked before playing)',
			'`!files [page]` \u2014 list local files in the music folder',
			'`!pause` / `!resume`',
			'`!skip`',
			'`!stop`',
			'`!queue`',
			'`!nowplaying`',
			'`!volume <0-100>`',
			'`!loop [off|track|queue]`',
			'`!leave`',
			'',
			'\u{1f525} **Loudness (escalating)**',
			'`!pump` \u2014 show current loudness level & presets',
			'`!pump <0-6>` \u2014 set a specific level',
			`\`!loud\` / \`!louder\` / \`!loudest\` / \`!max\` / \`!insane\` / \`!headphonekiller\``,
			'`!norm` / `!pumpoff` \u2014 reset to normal volume',
			'`!pumpup` \u2014 crank it one step, `!pumpdown` \u2014 eases it back',
			'',
			'\u{1f39b}\ufe0f **Extras**',
			'`!shuffle` \u2014 shuffle the queue',
			'`!fuckit` \u2014 max loudness + shuffle (the full send)',
			'`!eardrum` \u2014 \u201cstrongest music\u201d mode (headphone-killer)',
			'`!roast` \u2014 a friendly judgy remark',
			'`!vibe` \u2014 random hype line',
			'`!8ball <question>` \u2014 ask the oracle',
		].join('\n'),
	);
};

const pump: Command = async ({ player, message, send }, args) => {
	const value = Number(args[0]);
	if (args.length === 0 || Number.isNaN(value)) {
		const current = player.getPump();
		const list = PUMP_LEVELS.map(
			(step, index) =>
				`${index === player.getPumpLevel() ? '\u25b6\ufe0f' : '\u2003'} \`${index}\` **${step.name}** \u2014 ${step.description}`,
		).join('\n');
		return send(
			`\u{1f50a} Loudness level: **${player.getPumpLevel()} (${current.name})**\n${list}`,
		);
	}
	if (value < 0 || value > PUMP_LEVELS.length - 1) {
		return send(
			`Pick a level between \`0\` and \`${PUMP_LEVELS.length - 1}\`.`,
		);
	}
	player.setPumpLevel(value, message);
	const step = player.getPump();
	const warning =
		value >= 5 ? '\n\u26a0\ufe0f Ear protection strongly advised!' : '';
	return send(
		`\u{1f50a} Loudness set to **${value} (${step.name})** \u2014 ${step.description}${warning}`,
	);
};

async function setPumpAndAnnounce(
	ctx: CommandContext,
	level: number,
	label?: string,
): Promise<unknown> {
	const { player, message, send } = ctx;
	player.setPumpLevel(level, message);
	const step = player.getPump();
	const warning =
		level >= 5 ? '\n\u26a0\ufe0f Ear protection strongly advised!' : '';
	return send(
		`\u{1f50a} ${label ?? 'Loudness'} \u2192 **${step.name}** \u2014 ${step.description}${warning}`,
	);
}

const loud: Command = (ctx) => setPumpAndAnnounce(ctx, 1, 'Turned it up');
const louder: Command = (ctx) => setPumpAndAnnounce(ctx, 2, 'Louder');
const loudest: Command = (ctx) => setPumpAndAnnounce(ctx, 3, 'Loudest');
const max: Command = (ctx) => setPumpAndAnnounce(ctx, 4, 'MAX');
const insane: Command = (ctx) => setPumpAndAnnounce(ctx, 5, 'INSANE');
const headphonekiller: Command = (ctx) =>
	setPumpAndAnnounce(ctx, 6, '\u{1f480} HEADPHONE KILLER');

const pumpup: Command = async (ctx) => {
	const next = ctx.player.getPumpLevel() + 1;
	if (next > PUMP_LEVELS.length - 1) {
		return ctx.send('Already at maximum loudness. \u{1f525}');
	}
	return setPumpAndAnnounce(ctx, next, 'Pumped up');
};

const pumpdown: Command = async (ctx) => {
	const prev = ctx.player.getPumpLevel() - 1;
	if (prev < 0) {
		return ctx.send('Already at normal volume.');
	}
	return setPumpAndAnnounce(ctx, prev, 'Eased down');
};

const pumpoff: Command = async (ctx) => {
	ctx.player.setPumpLevel(0, ctx.message);
	return ctx.send('\u{1f50a} Back to normal loudness.');
};

const shuffle: Command = async ({ player, message, send }) => {
	const queue = player.getQueue();
	if (queue.length < 2) {
		return send('Not enough tracks in the queue to shuffle.');
	}
	player.shuffleQueue();
	void message;
	return send(`\u{1f500} Shuffled **${queue.length}** tracks.`);
};

const fuckit: Command = async (ctx) => {
	ctx.player.setPumpLevel(6, ctx.message);
	ctx.player.shuffleQueue();
	return ctx.send(
		'\u{1f525}\u{1f480} **FULL SEND** \u2014 headphone-killer loudness + shuffled queue. RIP your ears. \u{1f525}\u{1f480}',
	);
};

const eardrum: Command = async (ctx) => {
	ctx.player.setPumpLevel(6, ctx.message);
	const track = ctx.player.track;
	return ctx.send(
		`\u{1f4a5} **STRONGEST MUSIC MODE** \u2014 cranking${track ? ` **${track.title}**` : ''} to headphone-killer levels. Brace yourself!`,
	);
};

const ROASTS = [
	"You call this a queue? My grandma DJs harder.",
	'This playlist has fewer hits than my last ranked match.',
	"You play music like you type \u2014 one finger at a time.",
	'Bold of you to queue that in public.',
	'The only thing dropping harder than this beat is your standards.',
];

const roast: Command = async ({ send }) => {
	const line = ROASTS[Math.floor(Math.random() * ROASTS.length)];
	return send(`\u{1f525} ${line}`);
};

const VIBES = [
	'Speed it up, we got a vibe to catch \u26a1',
	'Turn it up until the neighbours file a complaint',
	'This one goes straight to the headphones \u{1f3a7}',
	'No skips, only hits \u{1f4a5}',
	'Volume is a suggestion, not a limit \u{1f50a}',
];

const vibe: Command = async ({ send }) => {
	const line = VIBES[Math.floor(Math.random() * VIBES.length)];
	return send(`\u2728 ${line}`);
};

const EIGHT_BALL = [
	'It is certain. \u{1f52e}',
	'Without a doubt. \u{1f52e}',
	'Ask again after the next drop. \u{1f52e}',
	'My sources say no. \u{1f52e}',
	'Cannot predict now \u2014 too busy vibing. \u{1f52e}',
	'Signs point to yes. \u{1f52e}',
];

const eightball: Command = async ({ send }, args) => {
	if (args.length === 0) {
		return send('Ask me a question: `!8ball will this song slap?`');
	}
	const answer = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)];
	return send(`\u{1f3b1} ${answer}`);
};

const commands: Record<string, Command> = {
	play: play,
	p: play,
	playfile: playfile,
	pf: playfile,
	local: playfile,
	files: files,
	list: files,
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
	pump: pump,
	loud: loud,
	louder: louder,
	loudest: loudest,
	max: max,
	insane: insane,
	headphonekiller: headphonekiller,
	hk: headphonekiller,
	pumpup: pumpup,
	pumpdown: pumpdown,
	pumpoff: pumpoff,
	norm: pumpoff,
	normal: pumpoff,
	shuffle: shuffle,
	fuckit: fuckit,
	eardrum: eardrum,
	roast: roast,
	vibe: vibe,
	'8ball': eightball,
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
