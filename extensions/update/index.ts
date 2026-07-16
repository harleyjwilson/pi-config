import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const APPROVE_BUILDS_PATTERNS = [
  /approve-builds/i,
  /ignored build scripts/i,
  /pnpm approve/i,
];

function compactOutput(output: string) {
  const trimmed = output.trim();
  if (!trimmed) return "No output.";
  return trimmed.length > 1200 ? `${trimmed.slice(-1200)}` : trimmed;
}

function needsPnpmBuildApproval(output: string) {
  return APPROVE_BUILDS_PATTERNS.some((pattern) => pattern.test(output));
}

async function currentVersion(pi: ExtensionAPI) {
  const result = await pi.exec("pi", ["--version"], { timeout: 10_000 });
  return result.stdout.trim() || result.stderr.trim() || "unknown";
}

function parseArgs(args: string) {
  return args.trim().split(/\s+/).filter(Boolean);
}

async function askForPnpmBuildApprovals(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const answer = await ctx.ui.input(
    "pnpm approve-builds",
    "Packages to approve, space-separated; use !pkg to reject; type all to approve all; blank skips",
  );
  const tokens = parseArgs(answer ?? "");
  if (tokens.length === 0) return false;

  const approveArgs = tokens.length === 1 && tokens[0]?.toLowerCase() === "all" ? ["approve-builds", "--all"] : ["approve-builds", ...tokens];
  const result = await pi.exec("pnpm", approveArgs, { timeout: 120_000 });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

  if (result.code !== 0) {
    ctx.ui.notify(`pnpm approve-builds failed. ${compactOutput(output)}`, "error");
    return false;
  }

  ctx.ui.notify(`pnpm approve-builds completed. ${compactOutput(output)}`, "info");
  return true;
}

async function updatePi(pi: ExtensionAPI, ctx: ExtensionCommandContext, args = "") {
  await ctx.waitForIdle();

  if (!ctx.hasUI) {
    console.log("Refusing to update Pi without an interactive confirmation.");
    return;
  }
  if (!(await ctx.ui.confirm("Update Pi?", "Run the built-in pi update command now?"))) return;

  const before = await currentVersion(pi).catch(() => "unknown");
  const updateArgs = ["update", ...parseArgs(args)];
  const label = `pi ${updateArgs.join(" ")}`;

  ctx.ui.notify(`Updating with built-in command: ${label}`, "info");

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await pi.exec("pi", updateArgs, { timeout: 300_000 });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

    if (result.code !== 0) {
      if (attempt === 1 && needsPnpmBuildApproval(output) && (await askForPnpmBuildApprovals(pi, ctx))) {
        ctx.ui.notify(`Retrying ${label} after pnpm build approvals`, "info");
        continue;
      }

      const approvalHint = needsPnpmBuildApproval(output)
        ? "\n\nPnpm appears to need build approval. Run `/update` again and enter the packages to approve, or run `pnpm approve-builds` manually."
        : "";
      ctx.ui.notify(`Pi update failed. ${compactOutput(output)}${approvalHint}`, "error");
      return;
    }

    const after = await currentVersion(pi).catch(() => "unknown");
    const changed = before !== after && before !== "unknown" && after !== "unknown";
    const summary = changed ? `Pi updated: ${before} → ${after}` : `Pi update completed (${after}).`;
    ctx.ui.notify(`${summary}\n${compactOutput(output)}`, "info");
    return;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag("update", {
    description: "Run the built-in `pi update` command on startup",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("update", {
    description: "Run the built-in `pi update` command. Extra args are passed through, e.g. `/update --self`.",
    handler: async (args, ctx) => {
      await updatePi(pi, ctx, args);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!pi.getFlag("update")) return;
    pi.sendUserMessage("/update", { deliverAs: "followUp" });
    ctx.ui.notify("Queued /update from --update", "info");
  });
}
