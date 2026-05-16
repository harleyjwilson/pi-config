import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const USAGE_MESSAGE = "Go to:\nhttps://chatgpt.com/codex/cloud/settings/analytics#usage";

export default function usageExtension(pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Show the Codex usage analytics URL",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) {
				ctx.ui.notify(USAGE_MESSAGE, "info");
			} else {
				console.log(USAGE_MESSAGE);
			}
		},
	});
}
