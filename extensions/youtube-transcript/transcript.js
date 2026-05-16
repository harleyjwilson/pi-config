#!/usr/bin/env node

import { fetchTranscript } from 'youtube-transcript-plus';

const video = process.argv[2];
const lang = process.argv[3];

if (!video) {
  console.error('Usage: transcript.js <video-id-or-url> [lang]');
  console.error('Example: transcript.js EBw7gsDPAYQ');
  console.error('Example: transcript.js https://www.youtube.com/watch?v=EBw7gsDPAYQ');
  console.error('Example: transcript.js https://youtu.be/EBw7gsDPAYQ en');
  process.exit(1);
}

try {
  const transcript = await fetchTranscript(extractVideoId(video), {
    lang,
    retries: 2,
    retryDelay: 1000,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  for (const entry of transcript) {
    const timestamp = formatTimestamp(entry.offset);
    console.log(`[${timestamp}] ${entry.text.replace(/\s+/g, ' ').trim()}`);
  }
} catch (error) {
  console.error('Error fetching transcript:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function extractVideoId(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtube.com')) {
      const fromV = url.searchParams.get('v');
      if (fromV && /^[a-zA-Z0-9_-]{11}$/.test(fromV)) return fromV;
      const pathMatch = url.pathname.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch) return pathMatch[1];
    }
    if (url.hostname === 'youtu.be' || url.hostname.endsWith('.youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
  } catch {
    // Not a URL; fall through to regex fallback.
  }

  const match = trimmed.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  return match?.[1] ?? trimmed;
}

function formatTimestamp(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
