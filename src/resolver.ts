import { spawn, spawnSync } from 'node:child_process';
import type { Readable } from 'node:stream';

export type SourceType = 'local' | 'youtube' | 'spotify' | 'search';

export interface Track {
	title: string;
	url: string;
	source: SourceType;
	duration?: number;
	thumbnail?: string;
	/**
	 * Local file path when `source === 'local'`, otherwise the web URL.
	 */
	input: string;
}

const SPOTIFY_TRACK = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\//i;
const SPOTIFY_COLLECTION =
	/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(album|playlist)\//i;

export class Resolver {
	readonly ffmpegPath: string;
	private readonly ytDlpPath: string;

	constructor() {
		this.ffmpegPath = Resolver.resolveFfmpeg();
		this.ytDlpPath = process.env.YT_DLP_PATH || 'yt-dlp';
	}

	static resolveFfmpeg(): string {
		const override = process.env.FFMPEG_PATH;
		if (override) return override;
		try {
			const ffmpegStatic = require('ffmpeg-static') as
				| string
				| { path?: string };
			const path =
				typeof ffmpegStatic === 'string'
					? ffmpegStatic
					: ffmpegStatic.path;
			if (path) return path;
		} catch {
			// fall through to system ffmpeg
		}
		return 'ffmpeg';
	}

	hasYtDlp(): boolean {
		const result = spawnSync(this.ytDlpPath, ['--version'], {
			stdio: 'ignore',
			windowsHide: true,
		});
		return !result.error;
	}

	isLocalPath(query: string): boolean {
		const ext = query.toLowerCase().split('?')[0].split('.').pop() ?? '';
		return [
			'mp3',
			'mp4',
			'wav',
			'ogg',
			'opus',
			'flac',
			'm4a',
			'webm',
			'aac',
			'mkv',
			'mov',
		].includes(ext);
	}

	/**
	 * Turn any user query into a playable track.
	 * Supports local mp3/mp4 files, YouTube URLs/queries and Spotify links.
	 */
	async resolve(query: string): Promise<Track> {
		const trimmed = query.trim();
		if (!trimmed) {
			throw new Error('Empty query.');
		}
		if (SPOTIFY_TRACK.test(trimmed)) {
			return this.resolveSpotify(trimmed, 'track');
		}
		if (SPOTIFY_COLLECTION.test(trimmed)) {
			return this.resolveSpotify(
				trimmed,
				SPOTIFY_COLLECTION.exec(trimmed)![1] as 'album' | 'playlist',
			);
		}
		if (/^https?:\/\//i.test(trimmed)) {
			return this.resolveUrl(trimmed);
		}
		if (this.isLocalPath(trimmed)) {
			return this.resolveLocal(trimmed);
		}
		return this.resolveSearch(trimmed);
	}

	resolveLocal(path: string): Track {
		const isVideo = /\.(mp4|mkv|mov|webm)$/i.test(path);
		return {
			title: path.split(/[\\/]/).pop() || path,
			url: path,
			source: 'local',
			input: path,
			thumbnail: isVideo ? undefined : undefined,
		};
	}

	async resolveUrl(url: string): Promise<Track> {
		const meta = await this.ytDlpJson(url).catch(() => null);
		if (meta) {
			return {
				title: meta.title ?? url,
				url: meta.webpage_url ?? url,
				source: 'youtube',
				duration: meta.duration,
				thumbnail: meta.thumbnail,
				input: meta.webpage_url ?? url,
			};
		}
		return {
			title: url,
			url,
			source: 'youtube',
			input: url,
		};
	}

	async resolveSearch(query: string): Promise<Track> {
		const meta = await this.ytDlpJson(`ytsearch1:${query}`).catch(
			() => null,
		);
		if (!meta) {
			throw new Error(
				`No YouTube result found for "${query}".`,
			);
		}
		return {
			title: meta.title ?? query,
			url: meta.webpage_url ?? `ytsearch1:${query}`,
			source: 'youtube',
			duration: meta.duration,
			thumbnail: meta.thumbnail,
			input: meta.webpage_url ?? `ytsearch1:${query}`,
		};
	}

	/**
	 * Spotify cannot be streamed directly, so resolve its metadata via the
	 * free oEmbed endpoint and play the matching track from YouTube.
	 */
	async resolveSpotify(
		url: string,
		kind: 'track' | 'album' | 'playlist',
	): Promise<Track> {
		const oembed = await fetch(
			`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
		)
			.then((res) => (res.ok ? (res.json() as any) : null))
			.catch(() => null);
		const searchQuery =
			kind === 'track' && oembed?.title
				? `${oembed.title}`
				: url;
		const track = await this.resolveSearch(searchQuery);
		return {
			...track,
			source: 'spotify',
			title: oembed?.title
				? `${oembed.title}`
				: track.title,
			thumbnail: oembed?.thumbnail_url ?? track.thumbnail,
		};
	}

	/**
	 * Return a ReadableStream of 16-bit stereo PCM audio (48kHz) via ffmpeg,
	 * suitable for `VoiceConnection#playAudio(stream, { type: 'converted' })`.
	 */
	createPcmStream(track: Track): Readable {
		let proc: ReturnType<typeof spawn>;
		if (track.source === 'local') {
			proc = spawn(
				this.ffmpegPath,
				[
					'-hide_banner',
					'-loglevel',
					'error',
					'-i',
					track.input,
					'-vn',
					'-f',
					's16le',
					'-ar',
					'48000',
					'-ac',
					'2',
					'pipe:1',
				],
				{ windowsHide: true },
			);
		} else {
			proc = spawn(
				this.ytDlpPath,
				[
					'--no-playlist',
					'-f',
					'bestaudio',
					'-o',
					'-',
					'--quiet',
					'--no-warnings',
					'-i',
					track.input,
				],
				{ windowsHide: true },
			);
		}
		return proc.stdout as Readable;
	}

	async ytDlpJson(target: string): Promise<any | null> {
		return new Promise((resolve) => {
			const proc = spawn(
				this.ytDlpPath,
				[
					'--dump-single-json',
					'--no-playlist',
					'--no-warnings',
					'--quiet',
					target,
				],
				{ windowsHide: true },
			);
			let out = '';
			let err = '';
			proc.stdout.on('data', (chunk) => (out += chunk));
			proc.stderr.on('data', (chunk) => (err += chunk));
			proc.on('error', () => resolve(null));
			proc.on('close', (code) => {
				if (code !== 0 || !out.trim()) {
					return resolve(null);
				}
				try {
					resolve(JSON.parse(out));
				} catch {
					resolve(null);
				}
			});
		});
	}
}
