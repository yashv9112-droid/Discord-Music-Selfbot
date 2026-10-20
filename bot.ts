import { Client } from 'discord.js-selfbot-v13';
import { handleCommand } from './src/commands';
import { GuildPlayer } from './src/player';
import { Resolver } from './src/resolver';

const token = process.env.TOKEN;
if (!token) {
	console.error('TOKEN is required. Copy .env.example to .env and set it.');
	process.exit(1);
}

const client = new Client({ patchVoice: true } as any);
const resolver = new Resolver();
const players = new Map<string, GuildPlayer>();

function getPlayer(guildId: string): GuildPlayer {
	let player = players.get(guildId);
	if (!player) {
		player = new GuildPlayer(client, resolver);
		player.on('start', (track) => {
			console.log(`[${guildId}] Now playing: ${track.title}`);
		});
		player.on('finish', (track) => {
			console.log(`[${guildId}] Finished: ${track.title}`);
		});
		player.on('empty', () => {
			console.log(`[${guildId}] Queue empty.`);
		});
		player.on('error', (error) => {
			console.error(`[${guildId}] Player error:`, error.message);
		});
		players.set(guildId, player);
	}
	return player;
}

client.once('ready', () => {
	console.log(`Logged in as ${client.user?.tag}`);
	console.log(
		resolver.hasYtDlp()
			? 'yt-dlp detected: YouTube and Spotify playback enabled.'
			: 'WARNING: yt-dlp not found. Install it for YouTube/Spotify playback (local files still work).',
	);
	console.log(`Prefix: !  \u2014 type "!help" in any channel.`);
});

client.on('messageCreate', async (message) => {
	if (message.author?.id !== client.user?.id) return;
	if (!message.guild) return;
	if (!message.content?.startsWith('!')) return;
	const player = getPlayer(message.guild.id);
	await handleCommand(message, player, resolver, client.user!.id);
});

client.on('error', (error) => {
	console.error('Client error:', error.message);
});

process.on('unhandledRejection', (reason) => {
	console.error('[Unhandled Rejection]', reason);
});
process.on('uncaughtException', (error) => {
	console.error('[Uncaught Exception]', error.message);
});

client.login(token);
