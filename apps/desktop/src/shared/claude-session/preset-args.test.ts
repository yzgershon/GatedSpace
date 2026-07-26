import { describe, expect, it } from "bun:test";
import { sanitizePresetArgs } from "./preset-args";

describe("sanitizePresetArgs", () => {
	it("keeps flags the pane doesn't control", () => {
		expect(
			sanitizePresetArgs([
				"--mcp-config",
				"./mcp.json",
				"--add-dir",
				"C:/Dev/other",
			]),
		).toEqual(["--mcp-config", "./mcp.json", "--add-dir", "C:/Dev/other"]);
	});

	it("drops permission mode, which the composer owns", () => {
		// This is the shipped default preset: `claude --permission-mode acceptEdits`.
		// Honoring it would silently contradict the mode shown in the dropdown.
		expect(sanitizePresetArgs(["--permission-mode", "acceptEdits"])).toEqual(
			[],
		);
	});

	it("drops the protocol flags that make the session readable", () => {
		expect(
			sanitizePresetArgs([
				"--print",
				"--output-format",
				"text",
				"--verbose",
				"--keep-me",
			]),
		).toEqual(["--keep-me"]);
	});

	it("eats the value of a dropped flag, not the argument after it", () => {
		expect(
			sanitizePresetArgs(["--resume", "abc-123", "--add-dir", "C:/Dev"]),
		).toEqual(["--add-dir", "C:/Dev"]);
	});

	it("handles the --flag=value spelling without eating a neighbour", () => {
		expect(
			sanitizePresetArgs(["--permission-mode=plan", "--add-dir", "C:/Dev"]),
		).toEqual(["--add-dir", "C:/Dev"]);
	});

	it("honors a preset's model pin, unless the pane set one", () => {
		expect(sanitizePresetArgs(["--model", "claude-opus-4-8"])).toEqual([
			"--model",
			"claude-opus-4-8",
		]);
		expect(
			sanitizePresetArgs(["--model", "claude-opus-4-8"], { hasModel: true }),
		).toEqual([]);
	});

	it("drops --continue, which would fight --resume", () => {
		expect(sanitizePresetArgs(["-c", "--add-dir", "C:/Dev"])).toEqual([
			"--add-dir",
			"C:/Dev",
		]);
	});

	it("leaves an empty preset empty", () => {
		expect(sanitizePresetArgs([])).toEqual([]);
	});
});
