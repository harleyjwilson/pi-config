/**
 * Q&A extraction hook - extracts questions and structured decision prompts from the active conversation
 *
 * Custom interactive TUI for answering questions.
 *
 * Demonstrates the "prompt generator" pattern with custom TUI:
 * 1. /answer command finds the most recent locally recognizable question or decision prompt
 * 2. Shows a spinner while extracting questions as structured JSON
 * 3. Presents an interactive TUI to navigate and answer questions
 * 4. Submits the compiled answers when done
 */

import { complete, type Model, type Api, type UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// Structured output format for question extraction
interface ExtractedQuestion {
	question: string;
	context?: string;
}

interface ExtractionResult {
	questions: ExtractedQuestion[];
}

interface ExtractionOutcome {
	result: ExtractionResult | null;
	error?: string;
}

const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Return only the JSON object—no prose, Markdown, or code fences
- Extract all questions and explicit requests that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- In numbered lists, include wrapped continuation lines as part of the same question
- If a numbered item is only a section heading and its bullets are questions, extract each bullet as a question and use the heading as context
- When a message defines lettered choices (for example, A/B/C) and asks for one choice per numbered item, extract every numbered item as a question; include the choice definitions and section heading as context
- Treat text like "Templates: should templates be project-level only..." as a question even if it has no trailing question mark
- If no questions are found, return {"questions": []}

Example output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?"
    }
  ]
}`;

const CODEX_MODEL_ID = "gpt-5.1-codex-mini";
const HAIKU_MODEL_ID = "claude-haiku-4-5";

/**
 * Prefer Codex mini for extraction when available, otherwise fallback to haiku or the current model.
 */
async function selectExtractionModel(
	currentModel: Model<Api>,
	modelRegistry: ModelRegistry,
): Promise<Model<Api>> {
	const codexModel = modelRegistry.find("openai-codex", CODEX_MODEL_ID);
	if (codexModel) {
		const auth = await modelRegistry.getApiKeyAndHeaders(codexModel);
		if (auth.ok) {
			return codexModel;
		}
	}

	const haikuModel = modelRegistry.find("anthropic", HAIKU_MODEL_ID);
	if (!haikuModel) {
		return currentModel;
	}

	const auth = await modelRegistry.getApiKeyAndHeaders(haikuModel);
	if (!auth.ok) {
		return currentModel;
	}

	return haikuModel;
}

/**
 * Find the end of a JSON object without being confused by braces inside strings.
 */
function findJsonObjectEnd(text: string, start: number): number | null {
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = start; index < text.length; index++) {
		const character = text[index];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (character === "\\") {
				escaped = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}

		if (character === '"') {
			inString = true;
		} else if (character === "{") {
			depth++;
		} else if (character === "}" && --depth === 0) {
			return index + 1;
		}
	}

	return null;
}

/**
 * Parse the JSON response from the LLM. The extractor should return JSON only,
 * but accepting a JSON object embedded in prose prevents a recoverable format
 * deviation from aborting the whole Q&A flow.
 */
function parseExtractionResult(text: string): ExtractionResult | null {
	const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidates = [codeBlock, text].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		for (let start = candidate.indexOf("{"); start !== -1; start = candidate.indexOf("{", start + 1)) {
			const end = findJsonObjectEnd(candidate, start);
			if (end === null) continue;

			try {
				const parsed: unknown = JSON.parse(candidate.slice(start, end));
				if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as ExtractionResult).questions)) {
					continue;
				}

				const questions = (parsed as ExtractionResult).questions
					.filter((question): question is ExtractedQuestion =>
						Boolean(question) && typeof question.question === "string" && question.question.trim().length > 0,
					)
					.map(({ question, context }) => ({
						question: normalizeQuestionText(question),
						...(typeof context === "string" && context.trim() ? { context: normalizeQuestionText(context) } : {}),
					}));
				return { questions };
			} catch {
				// Try the next JSON-looking object in the response.
			}
		}
	}

	return null;
}

const QUESTION_START_RE = /^(?:can|could|do|does|did|should|would|will|what|when|where|which|who|why|how|is|are|am|was|were)\b/i;
const REQUEST_START_RE = /^(?:(?:please|kindly)\s+)?(?:provide|share|give|list|supply|confirm|identify|name|describe|summarize|explain|calculate|show)\b/i;
const NUMBERED_ITEM_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const BULLET_ITEM_RE = /^\s*[-*+]\s+(.*)$/;
const CHOICE_LEGEND_ITEM_RE = /^\s*[-*+]\s*([A-Z])\s*=\s*(.+)$/i;

function normalizeQuestionText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function looksLikeQuestion(text: string): boolean {
	const normalized = normalizeQuestionText(text);
	if (!normalized) return false;
	if (normalized.includes("?")) return true;

	const withoutLeadingLabel = normalized.replace(/^[^:]{1,80}:\s*/, "");
	return QUESTION_START_RE.test(withoutLeadingLabel);
}

function looksLikeRequestHeading(text: string): boolean {
	return REQUEST_START_RE.test(normalizeQuestionText(text).replace(/:$/, ""));
}

/**
 * Extract numbered items from a multiple-choice decision list without asking an LLM.
 *
 * This supports package-reconciliation prompts that define choices such as
 * "A = add it to the other OS" and then ask for one A/B/C response per item.
 */
function extractNumberedChoiceList(text: string): ExtractionResult | null {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const choiceLegend = new Map<string, string>();

	for (const line of lines) {
		const choiceMatch = line.match(CHOICE_LEGEND_ITEM_RE);
		if (choiceMatch) {
			choiceLegend.set(choiceMatch[1].toUpperCase(), normalizeQuestionText(choiceMatch[2]));
		}
	}

	if (!["A", "B", "C"].every((choice) => choiceLegend.has(choice))) {
		return null;
	}

	const choiceContext = ["A", "B", "C"]
		.map((choice) => `${choice} = ${choiceLegend.get(choice)}`)
		.join("\n");
	const questions: ExtractedQuestion[] = [];
	let currentSectionHeading: string | undefined;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const rawLine = lines[lineIndex];
		const numberedMatch = rawLine.match(NUMBERED_ITEM_RE);
		if (numberedMatch) {
			const item = normalizeQuestionText(numberedMatch[2]);
			if (item) {
				const question = `${numberedMatch[1]}. ${item}`;
				const context = [currentSectionHeading, choiceContext].filter(Boolean).join("\n");
				questions.push({ question, context });
			}
			continue;
		}

		if (rawLine.match(BULLET_ITEM_RE) || !rawLine.trim()) {
			continue;
		}

		const previousLineIsBlank = lineIndex === 0 || !lines[lineIndex - 1].trim();
		const nextLineIsBlank = lineIndex === lines.length - 1 || !lines[lineIndex + 1].trim();
		if (previousLineIsBlank || nextLineIsBlank) {
			currentSectionHeading = normalizeQuestionText(rawLine).replace(/:$/, "") || undefined;
		}
	}

	return questions.length > 0 ? { questions } : null;
}

/**
 * Fast local extraction for structured numbered/bulleted question lists.
 *
 * LLM extraction can be unreliable for messages like:
 *   3. Postgres config:
 *      - Should I create a .env-based setup?
 *      - What DB name/user/password/host/port should be default?
 *
 * This parser preserves order, handles wrapped numbered items, and treats bullets under
 * a non-question heading as their own questions with the heading as context.
 */
function extractStructuredQuestionList(text: string): ExtractionResult | null {
	const questions: ExtractedQuestion[] = [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let currentNumbered: { text: string; bullets: string[]; requestContext?: string } | null = null;
	let currentBulletIndex: number | null = null;
	let requestContext: string | undefined;

	const addRequestedItem = (item: string, context?: string) => {
		const question = normalizeQuestionText(item);
		if (!question) return;
		if (looksLikeQuestion(question) || context) {
			questions.push({ question, ...(context ? { context } : {}) });
		}
	};

	const flushCurrent = () => {
		if (!currentNumbered) return;

		const heading = normalizeQuestionText(currentNumbered.text);
		if (currentNumbered.bullets.length > 0) {
			for (const bullet of currentNumbered.bullets) {
				const bulletText = normalizeQuestionText(bullet);
				if (!bulletText) continue;

				if (
					currentNumbered.requestContext ||
					looksLikeQuestion(heading) ||
					looksLikeQuestion(bulletText)
				) {
					const context = looksLikeQuestion(heading)
						? heading
						: currentNumbered.requestContext ?? heading.replace(/:$/, "");
					addRequestedItem(bulletText, context);
				}
			}
		} else {
			addRequestedItem(heading, currentNumbered.requestContext);
		}

		currentNumbered = null;
		currentBulletIndex = null;
	};

	for (const rawLine of lines) {
		const normalizedLine = normalizeQuestionText(rawLine);
		const numberedMatch = rawLine.match(NUMBERED_ITEM_RE);
		if (numberedMatch) {
			flushCurrent();
			currentNumbered = { text: numberedMatch[2], bullets: [], requestContext };
			continue;
		}

		if (!currentNumbered) {
			if (looksLikeRequestHeading(normalizedLine)) {
				requestContext = normalizedLine.replace(/:$/, "");
			}
			continue;
		}

		const bulletMatch = rawLine.match(BULLET_ITEM_RE);
		if (bulletMatch) {
			currentNumbered.bullets.push(bulletMatch[1]);
			currentBulletIndex = currentNumbered.bullets.length - 1;
			continue;
		}

		const continuation = rawLine.trim();
		if (!continuation) continue;

		if (currentBulletIndex !== null) {
			currentNumbered.bullets[currentBulletIndex] += ` ${continuation}`;
		} else if (/^\s+/.test(rawLine)) {
			currentNumbered.text += ` ${continuation}`;
		} else {
			flushCurrent();
			if (looksLikeRequestHeading(normalizedLine)) {
				requestContext = normalizedLine.replace(/:$/, "");
			}
		}
	}

	flushCurrent();

	return questions.length > 0 ? { questions } : null;
}

/**
 * Interactive Q&A component for answering extracted questions
 */
class QnAComponent implements Component {
	private questions: ExtractedQuestion[];
	private answers: string[];
	private currentIndex: number = 0;
	private editor: Editor;
	private tui: TUI;
	private onDone: (result: string | null) => void;
	private showingConfirmation: boolean = false;

	// Cache
	private cachedWidth?: number;
	private cachedLines?: string[];

	// Colors - using proper reset sequences
	private dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
	private bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
	private cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
	private green = (s: string) => `\x1b[32m${s}\x1b[0m`;
	private yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
	private gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

	constructor(
		questions: ExtractedQuestion[],
		tui: TUI,
		onDone: (result: string | null) => void,
	) {
		this.questions = questions;
		this.answers = questions.map(() => "");
		this.tui = tui;
		this.onDone = onDone;

		// Create a minimal theme for the editor
		const editorTheme: EditorTheme = {
			borderColor: this.dim,
			selectList: {
				selectedBg: (s: string) => `\x1b[44m${s}\x1b[0m`,
				matchHighlight: this.cyan,
				itemSecondary: this.gray,
			},
		};

		this.editor = new Editor(tui, editorTheme);
		// Disable the editor's built-in submit (which clears the editor)
		// We'll handle Enter ourselves to preserve the text
		this.editor.disableSubmit = true;
		this.editor.onChange = () => {
			this.invalidate();
			this.tui.requestRender();
		};
	}

	private saveCurrentAnswer(): void {
		this.answers[this.currentIndex] = this.editor.getText();
	}

	private navigateTo(index: number): void {
		if (index < 0 || index >= this.questions.length) return;
		this.saveCurrentAnswer();
		this.currentIndex = index;
		this.editor.setText(this.answers[index] || "");
		this.invalidate();
	}

	private submit(): void {
		this.saveCurrentAnswer();

		// Build the response text
		const parts: string[] = [];
		for (let i = 0; i < this.questions.length; i++) {
			const q = this.questions[i];
			const a = this.answers[i]?.trim() || "(no answer)";
			parts.push(`Q: ${q.question}`);
			if (q.context) {
				parts.push(`> ${q.context}`);
			}
			parts.push(`A: ${a}`);
			parts.push("");
		}

		this.onDone(parts.join("\n").trim());
	}

	private cancel(): void {
		this.onDone(null);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(data: string): void {
		// Handle confirmation dialog
		if (this.showingConfirmation) {
			if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
				this.submit();
				return;
			}
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data.toLowerCase() === "n") {
				this.showingConfirmation = false;
				this.invalidate();
				this.tui.requestRender();
				return;
			}
			return;
		}

		// Global navigation and commands
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.cancel();
			return;
		}

		// Tab / Shift+Tab for navigation
		if (matchesKey(data, Key.tab)) {
			if (this.currentIndex < this.questions.length - 1) {
				this.navigateTo(this.currentIndex + 1);
				this.tui.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			if (this.currentIndex > 0) {
				this.navigateTo(this.currentIndex - 1);
				this.tui.requestRender();
			}
			return;
		}

		// Arrow up/down for question navigation when editor is empty
		// (Editor handles its own cursor navigation when there's content)
		if (matchesKey(data, Key.up) && this.editor.getText() === "") {
			if (this.currentIndex > 0) {
				this.navigateTo(this.currentIndex - 1);
				this.tui.requestRender();
				return;
			}
		}
		if (matchesKey(data, Key.down) && this.editor.getText() === "") {
			if (this.currentIndex < this.questions.length - 1) {
				this.navigateTo(this.currentIndex + 1);
				this.tui.requestRender();
				return;
			}
		}

		// Handle Enter ourselves (editor's submit is disabled)
		// Plain Enter moves to next question or shows confirmation on last question
		// Shift+Enter adds a newline (handled by editor)
		if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
			this.saveCurrentAnswer();
			if (this.currentIndex < this.questions.length - 1) {
				this.navigateTo(this.currentIndex + 1);
			} else {
				// On last question - show confirmation
				this.showingConfirmation = true;
			}
			this.invalidate();
			this.tui.requestRender();
			return;
		}

		// Pass to editor
		this.editor.handleInput(data);
		this.invalidate();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const boxWidth = Math.min(width - 4, 120); // Allow wider box
		const contentWidth = boxWidth - 4; // 2 chars padding on each side

		// Helper to create horizontal lines (dim the whole thing at once)
		const horizontalLine = (count: number) => "─".repeat(count);

		// Helper to create a box line
		const boxLine = (content: string, leftPad: number = 2): string => {
			const paddedContent = " ".repeat(leftPad) + content;
			const contentLen = visibleWidth(paddedContent);
			const rightPad = Math.max(0, boxWidth - contentLen - 2);
			return this.dim("│") + paddedContent + " ".repeat(rightPad) + this.dim("│");
		};

		const emptyBoxLine = (): string => {
			return this.dim("│") + " ".repeat(boxWidth - 2) + this.dim("│");
		};

		const padToWidth = (line: string): string => {
			const len = visibleWidth(line);
			return line + " ".repeat(Math.max(0, width - len));
		};

		// Title
		lines.push(padToWidth(this.dim("╭" + horizontalLine(boxWidth - 2) + "╮")));
		const title = `${this.bold(this.cyan("Questions"))} ${this.dim(`(${this.currentIndex + 1}/${this.questions.length})`)}`;
		lines.push(padToWidth(boxLine(title)));
		lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));

		// Progress indicator
		const progressParts: string[] = [];
		for (let i = 0; i < this.questions.length; i++) {
			const answered = (this.answers[i]?.trim() || "").length > 0;
			const current = i === this.currentIndex;
			if (current) {
				progressParts.push(this.cyan("●"));
			} else if (answered) {
				progressParts.push(this.green("●"));
			} else {
				progressParts.push(this.dim("○"));
			}
		}
		lines.push(padToWidth(boxLine(progressParts.join(" "))));
		lines.push(padToWidth(emptyBoxLine()));

		// Current question
		const q = this.questions[this.currentIndex];
		const questionText = `${this.bold("Q:")} ${q.question}`;
		const wrappedQuestion = wrapTextWithAnsi(questionText, contentWidth);
		for (const line of wrappedQuestion) {
			lines.push(padToWidth(boxLine(line)));
		}

		// Context if present
		if (q.context) {
			lines.push(padToWidth(emptyBoxLine()));
			const contextText = this.gray(`> ${q.context}`);
			const wrappedContext = wrapTextWithAnsi(contextText, contentWidth - 2);
			for (const line of wrappedContext) {
				lines.push(padToWidth(boxLine(line)));
			}
		}

		lines.push(padToWidth(emptyBoxLine()));

		// Render the editor component (multi-line input) with padding
		// Skip the first and last lines (editor's own border lines)
		const answerPrefix = this.bold("A: ");
		const editorWidth = contentWidth - 4 - 3; // Extra padding + space for "A: "
		const editorLines = this.editor.render(editorWidth);
		for (let i = 1; i < editorLines.length - 1; i++) {
			if (i === 1) {
				// First content line gets the "A: " prefix
				lines.push(padToWidth(boxLine(answerPrefix + editorLines[i])));
			} else {
				// Subsequent lines get padding to align with the first line
				lines.push(padToWidth(boxLine("   " + editorLines[i])));
			}
		}

		lines.push(padToWidth(emptyBoxLine()));

		// Confirmation dialog or footer with controls
		if (this.showingConfirmation) {
			lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
			const confirmMsg = `${this.yellow("Submit all answers?")} ${this.dim("(Enter/y to confirm, Esc/n to cancel)")}`;
			lines.push(padToWidth(boxLine(truncateToWidth(confirmMsg, contentWidth))));
		} else {
			lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
			const controls = `${this.dim("Tab/Enter")} next · ${this.dim("Shift+Tab")} prev · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
			lines.push(padToWidth(boxLine(truncateToWidth(controls, contentWidth))));
		}
		lines.push(padToWidth(this.dim("╰" + horizontalLine(boxWidth - 2) + "╯")));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

export default function (pi: ExtensionAPI) {
	const answerHandler = async (ctx: ExtensionContext) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("answer requires interactive mode", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			let lastAssistantText: string | undefined;
			let extractionResult: ExtractionResult | null = null;

			// Prefer a locally recognizable prompt anywhere on the active branch. This lets
			// /answer recover a numbered choice list after intervening status messages and
			// supports an explicitly submitted decision list from the user.
			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i];
				if (entry.type !== "message") continue;

				const message = entry.message;
				if (!("role" in message) || (message.role !== "assistant" && message.role !== "user")) continue;
				if (message.role === "assistant" && message.stopReason !== "stop") continue;

				const text = message.content
					.filter((content): content is { type: "text"; text: string } => content.type === "text")
					.map((content) => content.text)
					.join("\n");
				if (!text) continue;

				if (message.role === "assistant" && !lastAssistantText) {
					lastAssistantText = text;
				}

				const locallyExtractedQuestions =
					extractNumberedChoiceList(text) ?? extractStructuredQuestionList(text);
				if (locallyExtractedQuestions) {
					extractionResult = locallyExtractedQuestions;
					break;
				}
			}

			if (!extractionResult && !lastAssistantText) {
				ctx.ui.notify("No completed assistant messages found", "error");
				return;
			}

			let extractionOutcome: ExtractionOutcome = { result: extractionResult };

			if (!extractionResult) {
				// Select the best model for extraction (prefer Codex mini, then haiku) only when
				// the message is not a structured numbered/bulleted list we can parse locally.
				const extractionModel = await selectExtractionModel(ctx.model, ctx.modelRegistry);

				// Run extraction with loader UI
				extractionOutcome = await ctx.ui.custom<ExtractionOutcome>((tui, theme, _kb, done) => {
					const loader = new BorderedLoader(tui, theme, `Extracting questions using ${extractionModel.id}...`);
					loader.onAbort = () => done({ result: null });

					const doExtract = async () => {
						const auth = await ctx.modelRegistry.getApiKeyAndHeaders(extractionModel);
						if (!auth.ok) {
							throw new Error(auth.error);
						}
						const userMessage: UserMessage = {
							role: "user",
							content: [{ type: "text", text: lastAssistantText! }],
							timestamp: Date.now(),
						};

						const response = await complete(
							extractionModel,
							{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
							{ apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
						);

						if (response.stopReason === "aborted") {
							return null;
						}

						const responseText = response.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("\n");

						const parsed = parseExtractionResult(responseText);
						if (!parsed) {
							throw new Error("Question extraction returned invalid JSON");
						}

						return parsed;
					};

					doExtract()
						.then((result) => done({ result }))
						.catch((error: unknown) =>
							done({
								result: null,
								error: error instanceof Error ? error.message : String(error),
							}),
						);

					return loader;
				});
			}

			if (extractionOutcome.error) {
				ctx.ui.notify(`Question extraction failed: ${extractionOutcome.error}`, "error");
				return;
			}

			extractionResult = extractionOutcome.result;
			if (extractionResult === null) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			if (extractionResult.questions.length === 0) {
				ctx.ui.notify("No questions found in the last message", "info");
				return;
			}

			// Show the Q&A component
			const answersResult = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
				return new QnAComponent(extractionResult.questions, tui, done);
			});

			if (answersResult === null) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			// Send the answers directly as a message and trigger a turn
			pi.sendMessage(
				{
					customType: "answers",
					content: "I answered your questions in the following way:\n\n" + answersResult,
					display: true,
				},
				{ triggerTurn: true },
			);
	};

	pi.registerCommand("answer", {
		description: "Extract questions or numbered choices into interactive Q&A",
		handler: (_args, ctx) => answerHandler(ctx),
	});

	pi.registerShortcut("ctrl+.", {
		description: "Extract and answer questions",
		handler: answerHandler,
	});
}
