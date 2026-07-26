import { describe, expect, test } from "bun:test";
import { PANEL_COMMANDS, panelFor } from "./SlashPalette";

describe("panelFor", () => {
	test("matches each command that has a panel", () => {
		for (const command of PANEL_COMMANDS) {
			expect(panelFor(`/${command}`)).toBe(command);
		}
	});

	test("a PREFIX does not fire — the point of matching exactly", () => {
		// Firing here would run /context in the live session on the way to /clear.
		expect(panelFor("/c")).toBeNull();
		expect(panelFor("/cont")).toBeNull();
		expect(panelFor("/mod")).toBeNull();
	});

	test("a command with no panel stays null and gets sent as typed", () => {
		expect(panelFor("/clear")).toBeNull();
		expect(panelFor("/compact")).toBeNull();
		expect(panelFor("/effort high")).toBeNull();
	});

	test("case and surrounding whitespace don't matter", () => {
		expect(panelFor("  /Context  ")).toBe("context");
		expect(panelFor("/USAGE")).toBe("usage");
	});

	test("an argument means the user meant to run it, not browse it", () => {
		// "/model sonnet" is an instruction; the picker would be in the way.
		expect(panelFor("/model sonnet")).toBeNull();
	});

	test("plain text is never a panel", () => {
		expect(panelFor("context")).toBeNull();
		expect(panelFor("")).toBeNull();
	});
});
