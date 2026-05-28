#!/usr/bin/env node

import { fetchTranscript } from 'youtube-transcript-plus';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_LANG = 'en';

const video = process.argv[2];
const lang = normalizeLanguage(process.argv[3]);

if (!video) {
  console.error('Usage: transcript.js <video-id-or-url> [lang]');
  console.error('Example: transcript.js EBw7gsDPAYQ');
  console.error('Example: transcript.js https://www.youtube.com/watch?v=EBw7gsDPAYQ');
  console.error('Example: transcript.js https://youtu.be/EBw7gsDPAYQ en');
  process.exit(1);
}

try {
  const videoId = extractVideoId(video);
  const { transcript, warning } = await fetchTranscriptWithFallback(videoId, lang);

  if (warning) console.error(warning);

  for (const entry of transcript) {
    const timestamp = formatTimestamp(entry.offset);
    console.log(`[${timestamp}] ${decodeHtmlEntities(entry.text).replace(/\s+/g, ' ').trim()}`);
  }
} catch (error) {
  console.error('Error fetching transcript:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function fetchTranscriptWithFallback(videoId, requestedLang) {
  const options = { retries: 2, retryDelay: 1000, userAgent: USER_AGENT };

  try {
    return { transcript: await fetchTranscript(videoId, { ...options, lang: requestedLang }), warning: undefined };
  } catch (error) {
    if (!requestedLang) throw error;

    const tracks = await getCaptionTracks(videoId);
    const availableLanguages = tracks.map((track) => track.languageCode).filter(Boolean);
    if (!availableLanguages.length || availableLanguages.includes(requestedLang)) throw error;

    return {
      transcript: await fetchTranscript(videoId, options),
      warning: `Requested transcript language "${requestedLang}" is not available; used "${availableLanguages[0]}" instead.`,
    };
  }
}

async function getCaptionTracks(videoId) {
  const watchResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!watchResponse.ok) return [];

  const watchHtml = await watchResponse.text();
  const apiKey = watchHtml.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
  if (!apiKey) return [];

  const playerResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
      videoId,
    }),
  });
  if (!playerResponse.ok) return [];

  const playerJson = await playerResponse.json();
  const tracklist = playerJson?.captions?.playerCaptionsTracklistRenderer ?? playerJson?.playerCaptionsTracklistRenderer;
  return Array.isArray(tracklist?.captionTracks) ? tracklist.captionTracks : [];
}

function normalizeLanguage(lang) {
  const normalized = lang?.trim();
  if (!normalized) return DEFAULT_LANG;
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized) ? normalized : DEFAULT_LANG;
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

function decodeHtmlEntities(text) {
  return text.replace(/&(#(\d+)|#x([\da-fA-F]+)|amp|lt|gt|quot|apos|#39);/g, (entity, _numeric, decimal, hex) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" }[entity] ?? entity;
  });
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
