import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const WEEKLY_USAGE_BAR_WIDTH = 20;

type CodexUsageWindow = {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_at?: number;
	reset_after_seconds?: number;
};

type CodexUsageResponse = {
	rate_limit?: {
		primary_window?: CodexUsageWindow | null;
		secondary_window?: CodexUsageWindow | null;
	};
};

/** Returns the seven-day Codex rate limit window, regardless of its API position. */
function findWeeklyCodexUsageWindow(usage: CodexUsageResponse): CodexUsageWindow | undefined {
	const windows = [usage.rate_limit?.primary_window, usage.rate_limit?.secondary_window];
	return windows.find((window) => window?.limit_window_seconds === WEEKLY_WINDOW_SECONDS) ?? undefined;
}

/** Formats the Codex weekly limit as the percentage remaining and the local reset date and time. */
function formatWeeklyCodexUsage(window: CodexUsageWindow): string {
	const usedPercent = Math.min(100, Math.max(0, Math.round(window.used_percent ?? 0)));
	const remainingPercent = 100 - usedPercent;
	const filledSlots = Math.round((remainingPercent / 100) * WEEKLY_USAGE_BAR_WIDTH);
	const usageBar = `${"▓".repeat(filledSlots)}${"░".repeat(WEEKLY_USAGE_BAR_WIDTH - filledSlots)}`;
	const resetTimestamp = window.reset_at
		? window.reset_at * 1000
		: Date.now() + (window.reset_after_seconds ?? 0) * 1000;
	const resetDateTime = new Date(resetTimestamp).toLocaleString([], {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	return `Weekly limit: [${usageBar}] ${remainingPercent}% left (resets ${resetDateTime})`;
}

/** Fetches and displays the account's live Codex weekly usage limit. */
async function showWeeklyCodexUsage(ctx: ExtensionCommandContext): Promise<void> {
	const auth = await ctx.modelRegistry.getProviderAuth("openai-codex");
	const accessToken = auth?.auth.apiKey;
	if (!accessToken) {
		throw new Error("Codex usage: OpenAI Codex login is not available. Run /login first.");
	}

	const response = await fetch(CODEX_USAGE_ENDPOINT, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!response.ok) {
		throw new Error(`Codex usage: OpenAI returned HTTP ${response.status}.`);
	}

	const usage = (await response.json()) as CodexUsageResponse;
	const weeklyWindow = findWeeklyCodexUsageWindow(usage);
	if (!weeklyWindow) {
		throw new Error("Codex usage: weekly limit was not returned for this account.");
	}

	const weeklyUsageLine = formatWeeklyCodexUsage(weeklyWindow);
	if (ctx.hasUI) {
		ctx.ui.notify(weeklyUsageLine, "info");
	} else {
		console.log(weeklyUsageLine);
	}
}

export default function usageExtension(pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Show the Codex weekly limit percentage and reset time",
		handler: async (_args, ctx) => {
			try {
				await showWeeklyCodexUsage(ctx);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Codex usage: request failed.";
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else console.error(message);
			}
		},
	});
}
