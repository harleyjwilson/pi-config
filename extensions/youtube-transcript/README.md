# pi YouTube Transcript Extension

Adds a `youtube_transcript` tool and `/youtube-transcript` slash command to pi.

## Setup

```bash
cd ~/.pi/agent/extensions/youtube-transcript
npm install
```

Reload pi with `/reload` or restart pi.

## Tool

The agent can call `youtube_transcript` with:

- `video`: YouTube video ID or URL
- `lang`: optional transcript language code
- `timestamps`: include `[m:ss]` timestamps (default: true)
- `listLanguages`: list available captions instead of fetching one

## Command

```text
/youtube-transcript <video-id-or-url> [lang]
```

## CLI

```bash
~/.pi/agent/extensions/youtube-transcript/transcript.js <video-id-or-url> [lang]
```
