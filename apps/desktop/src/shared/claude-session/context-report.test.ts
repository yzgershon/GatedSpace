import { describe, expect, test } from "bun:test";
import { parseContextReport, parseModelReport } from "./context-report";

/** Captured verbatim from a real `/context` in a long session. */
const REAL = `## Context Usage

**Model:** claude-opus-5
**Tokens:** 419.8k / 1m (42%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3.7k | 0.4% |
| System tools | 15.5k | 1.6% |
| MCP tools (deferred) | 17.4k | 1.7% |
| Custom agents | 167 | 0.0% |
| Memory files | 7.4k | 0.7% |
| Messages | 388.4k | 38.8% |
| Free space | 580.2k | 58.0% |

### Custom Agents

| Agent Type | Source | Tokens |
|------------|--------|--------|
| meta-ads-creative | Project | 167 |

### Memory Files

| Type | Path | Tokens |
|------|------|--------|
| Project | C:\\Dev\\SecondBrain\\CLAUDE.md | 3.2k |
| AutoMem | C:\\Users\\yzger\\.claude-amitai\\memory\\MEMORY.md | 4.2k |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| banner-design | User | ~170 |
| dataviz | Built-in | ~380 |
`;

describe("parseContextReport", () => {
	const report = parseContextReport(REAL);

	test("reads the model", () => {
		expect(report.model).toBe("claude-opus-5");
	});

	test("reads used, total and percentage of the window", () => {
		expect(report.usedTokens).toBe("419.8k");
		expect(report.totalTokens).toBe("1m");
		expect(report.usedPercent).toBe(42);
	});

	test("keeps the token figures as printed, unit and all", () => {
		const messages = report.categories.find((c) => c.name === "Messages");
		expect(messages).toEqual({
			name: "Messages",
			tokens: "388.4k",
			percent: 38.8,
		});
	});

	test("takes every category row and no header or separator", () => {
		expect(report.categories).toHaveLength(7);
		expect(report.categories.map((c) => c.name)).not.toContain("Category");
	});

	test("a category name containing a parenthetical survives intact", () => {
		expect(report.categories.map((c) => c.name)).toContain(
			"MCP tools (deferred)",
		);
	});

	test("memory files put the PATH in the name and the type in the source", () => {
		expect(report.memoryFiles[0]).toEqual({
			name: "C:\\Dev\\SecondBrain\\CLAUDE.md",
			source: "Project",
			tokens: "3.2k",
		});
		expect(report.memoryFiles).toHaveLength(2);
	});

	test("custom agents read name-first, unlike memory files", () => {
		expect(report.customAgents[0]).toEqual({
			name: "meta-ads-creative",
			source: "Project",
			tokens: "167",
		});
	});

	test("skills keep their source so User and Built-in stay distinguishable", () => {
		expect(report.skills.map((s) => s.source)).toEqual(["User", "Built-in"]);
	});

	test("sections are found by heading, not position", () => {
		// Skills comes last here; a section inserted above must not shift it.
		const shuffled = parseContextReport(
			REAL.replace(
				"### Skills",
				"### Something New\n\n| a | b |\n|---|---|\n| x | y |\n\n### Skills",
			),
		);
		expect(shuffled.skills).toHaveLength(2);
	});

	test("absent optional sections are empty, not an error", () => {
		const minimal = parseContextReport(
			"## Context Usage\n\n**Tokens:** 10k / 1m (1%)\n",
		);
		expect(minimal.skills).toEqual([]);
		expect(minimal.memoryFiles).toEqual([]);
		expect(minimal.usedPercent).toBe(1);
	});

	test("junk input degrades instead of throwing", () => {
		const junk = parseContextReport("no tables here");
		expect(junk.model).toBeNull();
		expect(junk.categories).toEqual([]);
	});
});

describe("parseModelReport", () => {
	const REAL_MODEL =
		"Current model: Opus 5 (effort: xhigh)\nUsage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID.";

	test("reads the model in force", () => {
		expect(parseModelReport(REAL_MODEL).current).toBe("Opus 5");
	});

	test("reads the ids the CLI says it accepts", () => {
		const available = parseModelReport(REAL_MODEL).available;
		expect(available).toContain("sonnet");
		expect(available).toContain("opusplan");
		expect(available).toContain("opus[1m]");
	});

	test("drops the trailing prose so it can't be offered as a model", () => {
		const available = parseModelReport(REAL_MODEL).available;
		expect(available.some((id) => id.includes("full model ID"))).toBe(false);
		expect(available.some((id) => id.startsWith("or "))).toBe(false);
	});

	test("a reply with no list still yields the current model", () => {
		expect(parseModelReport("Current model: Sonnet 5").available).toEqual([]);
	});

	test("junk degrades to nulls rather than throwing", () => {
		expect(parseModelReport("").current).toBeNull();
	});
});
