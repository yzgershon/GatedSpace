import { describe, expect, it } from "bun:test";
import { draculaTheme } from "./dracula";
import { builtInThemes, getBuiltInTheme } from "./index";
import { koiTheme } from "./koi";

/**
 * A theme is a wall of hex codes, which is exactly the sort of thing that goes
 * subtly wrong and stays wrong: a typo'd digit is still a valid colour, and
 * nothing about it looks broken until someone notices the terminal's red is
 * slightly off. These pin the values that are supposed to be canonical.
 */

/** The official Dracula ANSI palette. Published and exact. */
const OFFICIAL_ANSI = {
	black: "#21222c",
	red: "#ff5555",
	green: "#50fa7b",
	yellow: "#f1fa8c",
	blue: "#bd93f9",
	magenta: "#ff79c6",
	cyan: "#8be9fd",
	white: "#f8f8f2",
	brightBlack: "#6272a4",
	brightRed: "#ff6e6e",
	brightGreen: "#69ff94",
	brightYellow: "#ffffa5",
	brightBlue: "#d6acff",
	brightMagenta: "#ff92df",
	brightCyan: "#a4ffff",
	brightWhite: "#ffffff",
} as const;

describe("the Dracula theme", () => {
	it("is registered and findable by id", () => {
		expect(getBuiltInTheme("dracula")).toBe(draculaTheme);
		expect(builtInThemes).toContain(draculaTheme);
	});

	it("uses the official ANSI palette exactly", () => {
		// `terminal` is optional on the Theme type, so assert it exists first —
		// otherwise a theme that shipped without one would pass this vacuously.
		const terminal = draculaTheme.terminal;
		expect(terminal).toBeDefined();
		if (!terminal) return;
		for (const [key, value] of Object.entries(OFFICIAL_ANSI)) {
			expect(terminal[key as keyof typeof OFFICIAL_ANSI]).toBe(value);
		}
	});

	it("uses pink as the accent, matching the app it was taken from", () => {
		// Dracula ships pink AND purple; BridgeSpace picks pink for primary
		// buttons, focus rings and active borders. Purple stays available as a
		// chart colour.
		expect(draculaTheme.ui.primary).toBe("#ff79c6");
		expect(draculaTheme.ui.ring).toBe("#ff79c6");
		expect(draculaTheme.ui.highlight).toBe("#ff79c6");
	});

	it("keeps the sidebar level with the background", () => {
		// Corrected from the real theme table: BridgeSpace has nothing darker
		// than the background, so panels rise ABOVE the chrome rather than the
		// chrome sinking below them. I had this inverted from the screenshots.
		expect(draculaTheme.ui.sidebar).toBe("#282a36");
		expect(draculaTheme.ui.background).toBe("#282a36");
		expect(draculaTheme.ui.card).not.toBe(draculaTheme.ui.background);
	});

	it("uses their softer UI foreground, not canonical Dracula white", () => {
		// #e4e4e0 rather than #f8f8f2 — warmer and dimmer, and most of why
		// their chrome text reads softer than a stock port.
		expect(draculaTheme.ui.foreground).toBe("#e4e4e0");
		// The terminal keeps the brighter white: chrome softens, code does not.
		expect(draculaTheme.terminal?.foreground).toBe("#f8f8f2");
	});

	it("uses their highlight opacities", () => {
		expect(draculaTheme.ui.highlightMatch).toBe("rgba(255, 121, 198, 0.280)");
		expect(draculaTheme.ui.highlightActive).toBe("rgba(255, 121, 198, 0.350)");
	});

	it("pairs dark text with every bright fill", () => {
		// Each of these is light enough that white on it fails contrast. Getting
		// one wrong produces unreadable text on a button rather than a crash.
		const pairs: Array<[string | undefined, string | undefined]> = [
			[draculaTheme.ui.primary, draculaTheme.ui.primaryForeground],
			[draculaTheme.ui.destructive, draculaTheme.ui.destructiveForeground],
			[draculaTheme.ui.success, draculaTheme.ui.successForeground],
			[draculaTheme.ui.warning, draculaTheme.ui.warningForeground],
			[draculaTheme.ui.info, draculaTheme.ui.infoForeground],
			[draculaTheme.ui.highlight, draculaTheme.ui.highlightForeground],
		];
		for (const [fill, text] of pairs) {
			expect(fill).toBeDefined();
			expect(text).toBe("#282a36");
		}
	});

	it("uses their muted grey rather than Dracula's comment blue", () => {
		// I had lifted #6272a4 for contrast. Their table just uses a neutral
		// grey, which solves the same problem without inventing a colour.
		expect(draculaTheme.ui.mutedForeground).toBe("#a5a6a7");
	});

	it("declares itself a dark built-in", () => {
		expect(draculaTheme.type).toBe("dark");
		expect(draculaTheme.isBuiltIn).toBe(true);
	});
});

describe("built-in theme ids", () => {
	it("are unique", () => {
		// Two themes sharing an id makes one of them permanently unreachable
		// through getBuiltInTheme.
		const ids = builtInThemes.map((theme) => theme.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("the Koi theme", () => {
	it("is registered and findable by id", () => {
		expect(getBuiltInTheme("koi")).toBe(koiTheme);
		expect(builtInThemes).toContain(koiTheme);
	});

	it("is a warm near-black, not a blue one", () => {
		// The character of the theme: #211719 carries red where most dark
		// themes carry blue. Red channel above blue is the whole point.
		const bg = koiTheme.ui.background;
		const red = Number.parseInt(bg.slice(1, 3), 16);
		const blue = Number.parseInt(bg.slice(5, 7), 16);
		expect(red).toBeGreaterThan(blue);
	});

	it("uses their vermilion accent throughout", () => {
		expect(koiTheme.ui.primary).toBe("#ff3131");
		expect(koiTheme.ui.ring).toBe("#ff3131");
		expect(koiTheme.ui.highlight).toBe("#ff3131");
		expect(koiTheme.ui.highlightMatch).toBe("rgba(255, 49, 49, 0.280)");
	});

	it("lets destructive share the accent instead of inventing a second red", () => {
		// A near-but-not-quite second red beside this one would only ever read
		// as a mistake.
		expect(koiTheme.ui.destructive).toBe(koiTheme.ui.primary);
	});

	it("puts dark text on every bright fill", () => {
		for (const text of [
			koiTheme.ui.primaryForeground,
			koiTheme.ui.destructiveForeground,
			koiTheme.ui.successForeground,
			koiTheme.ui.warningForeground,
			koiTheme.ui.infoForeground,
			koiTheme.ui.highlightForeground,
		]) {
			expect(text).toBe("#211719");
		}
	});

	it("keeps the terminal on the app's own dark", () => {
		// ANSI black and white are pulled onto Koi's background and foreground
		// so the terminal does not sit on a different dark than the app.
		expect(koiTheme.terminal?.background).toBe("#211719");
		expect(koiTheme.terminal?.black).toBe("#211719");
		expect(koiTheme.terminal?.white).toBe("#e4e4e0");
	});
});
