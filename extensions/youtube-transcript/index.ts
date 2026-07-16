import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchTranscript } from "youtube-transcript-plus";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_LANG = "en";

type TranscriptSegment = {
  text: string;
  offset: number;
  duration?: number;
  lang?: string;
};

type TranscriptResult = TranscriptSegment[] | { segments: TranscriptSegment[]; videoDetails?: Record<string, unknown> };

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  kind?: string;
};

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatTimestamp(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function decodeHtmlEntities(text: string) {
  return text.replace(/&(#(\d+)|#x([\da-fA-F]+)|amp|lt|gt|quot|apos|#39);/g, (entity, _numeric, decimal, hex) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" } as Record<string, string>)[entity] ?? entity;
  });
}

function truncateToolText(text: string) {
  const truncated = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncated.truncated) return truncated.content;
  return `${truncated.content}\n\n[Transcript truncated: ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)})]`;
}

function extractVideoId(input: string) {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtube.com")) {
      const fromV = url.searchParams.get("v");
      if (fromV && /^[a-zA-Z0-9_-]{11}$/.test(fromV)) return fromV;
      const shorts = url.pathname.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/);
      if (shorts) return shorts[1];
    }
    if (url.hostname === "youtu.be" || url.hostname.endsWith(".youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
  } catch {
    // Not a URL; fall through to the regex fallback.
  }

  const match = trimmed.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  return match?.[1] ?? trimmed;
}

function captionTrackName(track: CaptionTrack) {
  return track.name?.simpleText ?? track.name?.runs?.map((run) => run.text ?? "").join("") ?? track.languageCode ?? "Unknown";
}

function normalizeLanguage(lang?: string) {
  const normalized = lang?.trim();
  if (!normalized) return DEFAULT_LANG;
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized) ? normalized : DEFAULT_LANG;
}

async function getCaptionTracks(videoId: string, options: { userAgent: string; signal?: AbortSignal }) {
  const watchResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "User-Agent": options.userAgent },
    signal: options.signal,
  });
  if (!watchResponse.ok) return [];

  const watchHtml = await watchResponse.text();
  const apiKey = watchHtml.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
  if (!apiKey) return [];

  const playerResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": options.userAgent },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId,
    }),
    signal: options.signal,
  });
  if (!playerResponse.ok) return [];

  const playerJson = await playerResponse.json();
  const tracklist = playerJson?.captions?.playerCaptionsTracklistRenderer ?? playerJson?.playerCaptionsTracklistRenderer;
  return Array.isArray(tracklist?.captionTracks) ? (tracklist.captionTracks as CaptionTrack[]) : [];
}

async function fetchTranscriptWithFallback(
  videoId: string,
  options: { lang?: string; includeMetadata: boolean; signal?: AbortSignal },
) {
  const commonOptions = {
    userAgent: USER_AGENT,
    retries: 2,
    retryDelay: 1000,
    signal: options.signal,
  };

  try {
    const result = (await fetchTranscript(videoId, {
      ...commonOptions,
      lang: options.lang || undefined,
      videoDetails: options.includeMetadata,
    } as any)) as TranscriptResult;
    return { result, warning: undefined as string | undefined };
  } catch (error) {
    if (options.signal?.aborted || !options.lang) throw error;

    const tracks = await getCaptionTracks(videoId, { userAgent: USER_AGENT, signal: options.signal });
    const availableLanguages = tracks.map((track) => track.languageCode).filter(Boolean) as string[];
    if (!availableLanguages.length || availableLanguages.includes(options.lang)) throw error;

    const result = (await fetchTranscript(videoId, {
      ...commonOptions,
      videoDetails: options.includeMetadata,
    } as any)) as TranscriptResult;
    return {
      result,
      warning: `Requested transcript language "${options.lang}" is not available; used "${availableLanguages[0]}" instead.`,
    };
  }
}

async function getTranscript(params: {
  video: string;
  lang?: string;
  timestamps?: boolean;
  listOnly?: boolean;
  includeMetadata?: boolean;
  signal?: AbortSignal;
}) {
  const videoId = extractVideoId(params.video);
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error("Invalid YouTube video ID or URL");
  }
  const lang = normalizeLanguage(params.lang);

  if (params.listOnly) {
    const languages = await getCaptionTracks(videoId, { userAgent: USER_AGENT, signal: params.signal });
    const text = languages.length
      ? languages
          .map((language) => `- ${language.languageCode}: ${captionTrackName(language)}${language.kind === "asr" ? " (auto-generated)" : ""}`)
          .join("\n")
      : "No transcript languages were reported for this video.";
    return {
      videoId,
      text,
      details: { videoId, languages },
    };
  }

  const { result, warning } = await fetchTranscriptWithFallback(videoId, {
    lang,
    includeMetadata: params.includeMetadata ?? true,
    signal: params.signal,
  });
  const segments = Array.isArray(result) ? result : result.segments;
  const videoDetails = Array.isArray(result) ? undefined : result.videoDetails;

  const text = segments
    .map((entry) => {
      const line = decodeHtmlEntities(entry.text).replace(/\s+/g, " ").trim();
      if (!params.timestamps) return line;
      return `[${formatTimestamp(entry.offset)}] ${line}`;
    })
    .filter(Boolean)
    .join(params.timestamps ? "\n" : " ");

  return {
    videoId,
    text: truncateToolText(warning ? `${warning}\n\n${text}` : text),
    details: {
      videoId,
      lang,
      warning,
      videoDetails,
      segmentCount: segments.length,
      transcript: segments,
    },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "youtube_transcript",
    label: "YouTube Transcript",
    description: "Fetch transcripts/captions from YouTube videos for summarization and analysis.",
    promptSnippet: "Fetch timestamped transcripts or available transcript languages for YouTube videos.",
    promptGuidelines: [
      "Use youtube_transcript when the user asks to summarize, analyze, quote, or extract information from a YouTube video transcript.",
    ],
    parameters: Type.Object({
      video: Type.String({ description: "YouTube video ID or URL." }),
      lang: Type.Optional(Type.String({ description: "Optional caption language code, e.g. en, es, fr, pt-BR." })),
      timestamps: Type.Optional(Type.Boolean({ description: "Include [m:ss] timestamps. Defaults to true." })),
      listLanguages: Type.Optional(Type.Boolean({ description: "Only list available transcript languages instead of fetching a transcript." })),
      includeMetadata: Type.Optional(Type.Boolean({ description: "Include YouTube video metadata in tool details. Defaults to true." })),
    }),
    async execute(_toolCallId: unknown, params: any, signal?: AbortSignal, onUpdate?: (message: any) => void) {
      onUpdate?.({ content: [{ type: "text", text: "Fetching YouTube transcript..." }] });
      try {
        const result = await getTranscript({
          video: params.video,
          lang: params.lang,
          timestamps: params.timestamps ?? true,
          listOnly: params.listLanguages ?? false,
          includeMetadata: params.includeMetadata ?? true,
          signal,
        });
        return {
          content: [{ type: "text", text: result.text }],
          details: result.details,
        };
      } catch (error) {
        throw new Error(`Error fetching YouTube transcript: ${asErrorMessage(error)}`);
      }
    },
  });

  pi.registerCommand("youtube-transcript", {
    description: "Fetch a YouTube transcript. Usage: /youtube-transcript <video-id-or-url> [lang]",
    handler: async (args: string, ctx: any) => {
      const [video, lang] = args.trim().split(/\s+/);
      if (!video) {
        ctx.ui.notify("Usage: /youtube-transcript <video-id-or-url> [lang]", "error");
        return;
      }

      try {
        const result = await getTranscript({ video, lang, timestamps: true, includeMetadata: true });
        pi.sendMessage(
          {
            customType: "youtube-transcript",
            content: result.text,
            display: true,
            details: result.details,
          },
          { triggerTurn: false },
        );
        ctx.ui.notify(`Fetched transcript for ${result.videoId}`, "success");
      } catch (error) {
        ctx.ui.notify(`YouTube transcript failed: ${asErrorMessage(error)}`, "error");
      }
    },
  });
}
