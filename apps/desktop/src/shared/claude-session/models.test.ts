import { describe, expect, test } from "bun:test";
import { parseModelReport } from "./context-report";
import { claudeModelChoices, parseClaudeModels } from "./models";

describe("Claude runtime model choices", () => {
	test("preserves future versions and account restrictions instead of adding built-in choices", () => {
		const catalog = parseClaudeModels([
			{
				value: "claude-future-model",
				displayName: "Future model",
				description: "Provided by runtime",
			},
		]);
		expect(claudeModelChoices(null, catalog)).toEqual([
			{
				id: "claude-future-model",
				label: "Future model",
				description: "Provided by runtime",
			},
		]);
	});
	test("ignores malformed metadata, deduplicates IDs and never exposes extra response fields", () => {
		expect(
			parseClaudeModels([
				null,
				{},
				{ value: "" },
				{ value: "fable", account: "private" },
				{ value: "fable" },
			]),
		).toEqual([{ id: "fable", label: "fable", description: "" }]);
		expect(parseClaudeModels(null)).toEqual([]);
	});
	test("slash-command discovery offers unknown IDs as real choices", () => {
		const report = parseModelReport(
			"Current model: Fable 5.2\nAvailable: fable, claude-new-model, opus[1m], or a full model ID.",
		);
		expect(claudeModelChoices(report).map((model) => model.id)).toEqual([
			"fable",
			"claude-new-model",
			"opus[1m]",
		]);
	});
	test("offline fallback includes Fable and retains the established aliases", () => {
		expect(claudeModelChoices().map((model) => model.id)).toContain("fable");
	});
});
