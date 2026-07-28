/**
 * Guards the theme token system against the failure mode that made the
 * `@custom-variant dark` bug expensive: a utility that compiles fine, renders
 * nothing, and looks like a design choice rather than a defect.
 *
 * Three ways that happens, all checked here:
 *
 *  1. A token is aliased in `@theme` but never given a value, so `bg-warning`
 *     resolves to an empty custom property and the element is transparent.
 *  2. A token has a value in one theme and not the other, so it works until
 *     someone switches to light mode.
 *  3. This file's vocabulary is smaller than the desktop app's, so a component
 *     written in the shared library using `bg-success` works when the desktop
 *     compiles it and silently fails in any other consumer.
 *
 * None of the three produces an error anywhere — not at build, not at runtime,
 * not in a typecheck. A test is the only place they can be caught.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI_CSS = join(import.meta.dir, "globals.css");
const DESKTOP_CSS = join(
	import.meta.dir,
	"../../../apps/desktop/src/renderer/globals.css",
);

/** `--color-foo: var(--bar);` inside `@theme inline { ... }`. */
function themeAliases(css: string): Map<string, string> {
	const block = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
	const aliases = new Map<string, string>();
	for (const line of block.split("\n")) {
		const match = line.match(/^\s*(--color-[\w-]+):\s*var\((--[\w-]+)\)/);
		if (match?.[1] && match[2]) aliases.set(match[1], match[2]);
	}
	return aliases;
}

/**
 * The custom properties a given selector block defines.
 *
 * Matches on the selector at the start of a line so `:root` does not also
 * capture `:root.light`, which is a different block with different values.
 */
function definedVars(css: string, selector: string): Set<string> {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const block =
		css.match(new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"))?.[1] ??
		"";
	const names = new Set<string>();
	for (const line of block.split("\n")) {
		const match = line.match(/^\s*(--[\w-]+):/);
		if (match?.[1]) names.add(match[1]);
	}
	return names;
}

const uiCss = readFileSync(UI_CSS, "utf8");
const desktopCss = readFileSync(DESKTOP_CSS, "utf8");

describe("packages/ui theme tokens", () => {
	const aliases = themeAliases(uiCss);
	const light = definedVars(uiCss, ":root");
	const dark = definedVars(uiCss, ".dark");

	it("parses a real theme block", () => {
		// If the regexes ever stop matching, every other test here passes
		// vacuously — which would be worse than no test at all.
		expect(aliases.size).toBeGreaterThan(20);
		expect(light.size).toBeGreaterThan(20);
		expect(dark.size).toBeGreaterThan(20);
	});

	it("gives every aliased token a light value", () => {
		const missing = [...aliases]
			.filter(([, source]) => !light.has(source))
			.map(([token]) => token);
		expect(missing).toEqual([]);
	});

	it("gives every aliased token a dark value", () => {
		// The asymmetric case is the dangerous one: developed in dark mode,
		// broken in light, and nobody notices for months.
		const missing = [...aliases]
			.filter(([, source]) => !dark.has(source))
			.map(([token]) => token);
		expect(missing).toEqual([]);
	});

	it("resolves `dark:` from the app theme, not the OS", () => {
		// Tailwind v4 defaults `dark:` to a prefers-color-scheme media query.
		expect(uiCss).toContain("@custom-variant dark (&:is(.dark *))");
	});
});

describe("shared library vs desktop vocabulary", () => {
	const uiAliases = themeAliases(uiCss);
	const desktopAliases = themeAliases(desktopCss);

	it("reads the desktop theme too", () => {
		expect(desktopAliases.size).toBeGreaterThan(20);
	});

	it("defines every colour token the desktop defines", () => {
		// The desktop may add tokens; the shared library must not be the one
		// missing them, or components written here break for other consumers.
		const missing = [...desktopAliases.keys()].filter(
			(token) => !uiAliases.has(token),
		);
		expect(missing).toEqual([]);
	});
});

describe("desktop theme tokens", () => {
	const aliases = themeAliases(desktopCss);
	// Inverted from the shared library on purpose: the desktop's fallback
	// `:root` is its DARK (ember) theme, with `:root.light` overriding.
	const dark = definedVars(desktopCss, ":root");
	const light = definedVars(desktopCss, ":root.light");

	it("parses both theme blocks", () => {
		expect(dark.size).toBeGreaterThan(20);
		expect(light.size).toBeGreaterThan(20);
	});

	it("gives every aliased token a value in the default (dark) theme", () => {
		const missing = [...aliases]
			.filter(([, source]) => !dark.has(source))
			.map(([token]) => token);
		expect(missing).toEqual([]);
	});

	it("gives every aliased token a light value", () => {
		const missing = [...aliases]
			.filter(([, source]) => !light.has(source))
			.map(([token]) => token);
		expect(missing).toEqual([]);
	});
});
