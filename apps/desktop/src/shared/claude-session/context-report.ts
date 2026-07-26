/**
 * Parse the CLI's `/context` and `/model` replies.
 *
 * Both are answered locally, but unlike `/usage` they are about THIS session —
 * a throwaway process reported 23.6k context against a conversation actually
 * sitting at 377k. So they run in the live session with the reply captured, and
 * this turns the markdown that comes back into something renderable.
 *
 * Written against verbatim captured output. `/context` replies with real GFM
 * tables, so the parsing is table-shaped rather than line-shaped, and unknown
 * sections are ignored rather than fought with — the CLI adds them over time
 * (Custom agents and Memory files only appear when a project has them).
 */

export interface ContextCategory {
	name: string;
	/** As printed, e.g. "388.4k" — the CLI has already chosen the unit. */
	tokens: string;
	/** Parsed from the printed percentage; 38.8 means 38.8%. */
	percent: number;
}

export interface ContextEntry {
	name: string;
	/** "User" / "Project" / "Built-in", or an MCP server name. */
	source: string;
	tokens: string;
}

export interface ContextReport {
	model: string | null;
	/** "419.8k" */
	usedTokens: string | null;
	/** "1m" */
	totalTokens: string | null;
	/** 42 means 42% of the window is in use. */
	usedPercent: number | null;
	categories: ContextCategory[];
	memoryFiles: ContextEntry[];
	customAgents: ContextEntry[];
	skills: ContextEntry[];
	raw: string;
}

/** Split one GFM table row into trimmed cells, dropping the outer pipes. */
function cells(line: string): string[] {
	return line
		.replace(/^\s*\|/, "")
		.replace(/\|\s*$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
	return line.trim().startsWith("|");
}

/** A `|---|---|` separator carries no data. */
function isSeparatorRow(line: string): boolean {
	return /^\s*\|[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

function parsePercent(value: string): number {
	const match = /(-?[\d.]+)\s*%/.exec(value);
	return match ? Number.parseFloat(match[1] ?? "0") : 0;
}

export function parseContextReport(text: string): ContextReport {
	const report: ContextReport = {
		model: null,
		usedTokens: null,
		totalTokens: null,
		usedPercent: null,
		categories: [],
		memoryFiles: [],
		customAgents: [],
		skills: [],
		raw: text,
	};

	const modelMatch = /\*\*Model:\*\*\s*(.+)/.exec(text);
	if (modelMatch) report.model = (modelMatch[1] ?? "").trim();

	// "**Tokens:** 419.8k / 1m (42%)"
	const tokensMatch =
		/\*\*Tokens:\*\*\s*([\d.,a-zA-Z]+)\s*\/\s*([\d.,a-zA-Z]+)\s*\((\d+)%\)/.exec(
			text,
		);
	if (tokensMatch) {
		report.usedTokens = tokensMatch[1] ?? null;
		report.totalTokens = tokensMatch[2] ?? null;
		report.usedPercent = Number.parseInt(tokensMatch[3] ?? "0", 10);
	}

	// Walk sections, collecting the rows of whichever table is current. Matching
	// on the heading rather than table position means a new section inserted
	// upstream shifts nothing.
	let section: "categories" | "memory" | "agents" | "skills" | null = null;
	let sawHeaderRow = false;

	for (const line of text.split("\n")) {
		const heading = /^###\s+(.+)$/.exec(line.trim());
		if (heading) {
			const title = (heading[1] ?? "").toLowerCase();
			if (title.includes("by category")) section = "categories";
			else if (title.includes("memory")) section = "memory";
			else if (title.includes("agent")) section = "agents";
			else if (title.includes("skill")) section = "skills";
			else section = null;
			sawHeaderRow = false;
			continue;
		}

		if (!section) continue;
		if (!isTableRow(line)) continue;
		if (isSeparatorRow(line)) continue;

		// The first row of a table is its header ("| Category | Tokens | ... |").
		if (!sawHeaderRow) {
			sawHeaderRow = true;
			continue;
		}

		const row = cells(line);
		if (section === "categories") {
			const [name, tokens, percent] = row;
			if (name && tokens) {
				report.categories.push({
					name,
					tokens,
					percent: parsePercent(percent ?? ""),
				});
			}
			continue;
		}

		// Memory files print Type | Path | Tokens; the others Name | Source | Tokens.
		const [first, second, third] = row;
		if (!first || !third) continue;
		const entry: ContextEntry =
			section === "memory"
				? { name: second ?? "", source: first, tokens: third }
				: { name: first, source: second ?? "", tokens: third };
		if (section === "memory") report.memoryFiles.push(entry);
		else if (section === "agents") report.customAgents.push(entry);
		else report.skills.push(entry);
	}

	return report;
}

// ---------------------------------------------------------------------------
// /model
// ---------------------------------------------------------------------------

export interface ModelChoice {
	id: string;
	label: string;
	description: string;
}

/**
 * The models the CLI accepts, with the descriptions the reference UI shows.
 *
 * The ids come from the CLI's own `/model` reply — "Available: sonnet, opus,
 * haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default" — so
 * they're observed rather than guessed, which is what this was blocked on.
 * `parseModelIds` re-reads them at runtime so a CLI that adds one isn't
 * silently limited to this list.
 */
export const MODEL_CHOICES: ModelChoice[] = [
	{
		id: "default",
		label: "Default (recommended)",
		description: "Efficient for routine tasks",
	},
	{ id: "sonnet", label: "Sonnet", description: "Efficient for routine tasks" },
	{
		id: "fable",
		label: "Fable",
		description: "Most capable for the hardest, longest-running tasks",
	},
	{
		id: "opus",
		label: "Opus",
		description: "Best for everyday, complex tasks · ~2× usage vs Sonnet",
	},
	{ id: "haiku", label: "Haiku", description: "Fastest for quick answers" },
];

export interface ModelReport {
	/** The model in force, when the reply names one. */
	current: string | null;
	/** Every id the CLI says it accepts, in the order given. */
	available: string[];
	raw: string;
}

export function parseModelReport(text: string): ModelReport {
	const report: ModelReport = { current: null, available: [], raw: text };

	const current = /Current model:\s*([^\n(]+)/i.exec(text);
	if (current) report.current = (current[1] ?? "").trim();

	// "Available: sonnet, opus, haiku, ..., or a full model ID."
	const available = /Available:\s*([^\n]+)/i.exec(text);
	if (available) {
		report.available = (available[1] ?? "")
			.split(",")
			.map((id) => id.trim())
			.filter((id) => id && !/^or\b/i.test(id) && !id.includes(" "));
	}

	return report;
}
