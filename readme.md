# Discord Music Selfbot

A selfbot that plays music in Discord voice channels. It can play:

- **Local files** — `.mp3`, `.mp4`, `.wav`, `.ogg`, `.opus`, `.flac`, `.m4a`, `.webm`, `.aac`, `.mkv`, `.mov`
- **YouTube** — direct URLs, playlists (single video) and search terms
- **Spotify** — track/album/playlist links (resolved via the free oEmbed API, then played from YouTube)

> [!CAUTION]
> **Using this on a user account is prohibited by the [Discord TOS](https://discord.com/terms) and can lead to account suspension. Use at your own risk.**

## ✨ Features

- `!play` — local file, YouTube URL/search, or Spotify link
- Queue, skip, pause/resume, stop
- Volume control (0–100%)
- Loop modes: off / single track / whole queue
- Now-playing and queue views
- Auto-leave on `!leave`
- Bundled `ffmpeg` via `ffmpeg-static` (no system ffmpeg required)

## 📦 Requirements

| Requirement | Notes |
| --- | --- |
| **Node.js 24+** | Required |
| **ffmpeg** | Bundled via `ffmpeg-static`, no install needed |
| **yt-dlp** | Required for YouTube/Spotify playback (local files work without it). Install from the [yt-dlp releases](https://github.com/yt-dlp/yt-dlp#installation) or via your package manager |
| **Git** | To clone the repo |

## 🚀 Setup

```sh
git clone https://github.com/yashv9112-droid/Discord-Music-Selfbot.git
cd Discord-Music-Selfbot
npm install
cp .env.example .env   # then set TOKEN
npm start
```

### `.env`

```
TOKEN=your_discord_token
YT_DLP_PATH=            # optional, defaults to "yt-dlp" on PATH
FFMPEG_PATH=            # optional, defaults to bundled ffmpeg-static
```

### Local files (mp3/mp4)

Put your audio/video files in a `music/` folder next to the bot (or set `MUSIC_DIR` to any folder), then:

```
!files              # list everything found (recursive)
!playfile song.mp3  # play by filename
!play song.mp3      # works too
!play /home/you/Music/track.mp4
```

Supported extensions: `.mp3`, `.mp4`, `.wav`, `.ogg`, `.opus`, `.flac`, `.m4a`, `.webm`, `.aac`, `.mkv`, `.mov`. Paths with spaces work — wrap them in quotes if your shell needs it. Filters (`!pump`, etc.) apply to local files exactly like streams.

> [!WARNING]
> Local file playback uses paths relative to where the bot runs. To play a file on your machine, either run the bot on that machine or use a path the bot can read (e.g. `/home/you/Music/song.mp3`).

## 🎛️ Commands

| Command | Description |
| --- | --- |
| `!play <query>` | Play a local file, YouTube link/search, or Spotify link |
| `!playfile <path\|name>` | Play a local mp3/mp4 by path or filename (verified to exist first) |
| `!files [page]` | List local files found in the music folder |
| `!pause` / `!resume` | Pause or resume playback |
| `!skip` | Skip the current track |
| `!stop` | Stop and clear the queue |
| `!queue` | Show what's playing and what's next |
| `!nowplaying` | Show the current track |
| `!volume <0-100>` | Set the volume |
| `!loop [off\|track\|queue]` | Set (or cycle) the loop mode |
| `!leave` | Disconnect from the voice channel |
| `!help` | Show the command list |

### 🔥 Loudness ("strongest music" mode)

Playback gets progressively louder and punchier using stacked ffmpeg compression + gain. Level 6 is roughly **8× louder** than normal (measured by RMS) and will genuinely blow headphones off.

| Command | Description |
| --- | --- |
| `!pump` | Show the current level and all presets |
| `!pump <0-6>` | Set a specific loudness level |
| `!loud` / `!louder` / `!loudest` / `!max` / `!insane` / `!headphonekiller` | Jump straight to a level |
| `!pumpup` / `!pumpdown` | Crank it up / ease it back one step |
| `!norm` / `!pumpoff` | Reset to normal volume |

**Levels:** `0` off · `1` loud · `2` louder · `3` loudest · `4` max · `5` insane · `6` headphone-killer

### 🎛️ Extras

| Command | Description |
| --- | --- |
| `!shuffle` | Shuffle the queue |
| `!fuckit` | Max loudness + shuffled queue (the full send) |
| `!eardrum` | "Strongest music" mode (headphone-killer) |
| `!roast` | A friendly judgy remark |
| `!vibe` | Random hype line |
| `!8ball <question>` | Ask the oracle |

> [!WARNING]
> Loudness levels 5–6 boost the signal hard via compression and limiting. Listener hearing damage is on you — wear ear protection at high levels and don't run this on unsuspecting people.

The `!` prefix is configurable in `src/commands.ts` (`PREFIX`).

## 🧠 How Spotify support works

Spotify's API does not allow audio streaming. This bot fetches public track metadata through Spotify's oEmbed endpoint and then searches YouTube for the closest match. No Spotify API key is needed.

## ⚠️ Notes

- `yt-dlp` needs to be installed and kept up to date; YouTube changes often break extraction.
- If YouTube asks you to confirm you're not a robot, your IP is likely blocked — run from a residential network.
- You must be joined to a voice channel before running `!play`.

## 🙏 Credits

- [discord.js-selfbot-v13](https://github.com/aiko-chan-ai/discord.js-selfbot-v13)
- [prism-media](https://github.com/amishshah/prism-media) / [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

*README compiled with assistance from AI.*
