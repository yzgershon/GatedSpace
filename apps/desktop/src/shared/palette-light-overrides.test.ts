import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Keeps the light theme's palette corrections in step with the code.
 *
 * Roughly 300 colours in this app are written as fixed Tailwind palette
 * utilities (`text-emerald-500`, `bg-amber-500`). Those shades are chosen
 * against a dark background; on white a 300 or 400 shade is close to
 * invisible. Rather than rewrite 300 call sites, `globals.css` redefines the
 * palette variables inside `:root.light` — Tailwind v4 compiles
 * `text-emerald-500` to `color: var(--color-emerald-500)`, so the variable is
 * the single point of control.
 *
 * Two things make that safe, and this file guards the second:
 *
 *  1. The DARK theme defines no overrides at all, so it keeps Tailwind's stock
 *     values and cannot drift from what ships today.
 *  2. Every mid/light shade actually used has an override. A new
 *     `text-sky-400` added later would be unreadable in the light theme and
 *     nothing would say so — that is what this test catches.
 */

/*
 * Lives in shared/ rather than beside globals.css because renderer code is
 * barred from importing Node builtins (biome.jsonc), and this test has to read
 * files off disk to see what the components actually use.
 */
const RENDERER_DIR = join(import.meta.dir, "..", "renderer");
const GLOBALS_CSS = join(RENDERER_DIR, "globals.css");

/** Shades dark enough to read on white already, or used AS pale backgrounds. */
const SHADES_NEEDING_NO_OVERRIDE = new Set([50, 100, 200, 700, 800, 900, 950]);

const PALETTE_UTILITY =
	/\b(?:bg|text|border|ring|fill|stroke|decoration|from|to|via|shadow|outline|caret|accent|divide)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(\d{2,3})\b/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === "dist") continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, out);
		} else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

function usedPaletteShades(): Set<string> {
	const used = new Set<string>();
	for (const file of sourceFiles(RENDERER_DIR)) {
		const contents = readFileSync(file, "utf8");
		for (const match of contents.matchAll(PALETTE_UTILITY)) {
			used.add(`${match[1]}-${match[2]}`);
		}
	}
	return used;
}

/** The `:root.light` block, which is where the corrections live. */
function lightBlock(css: string): string {
	return css.match(/^:root\.light\s*\{([\s\S]*?)\n\}/m)?.[1] ?? "";
}

const css = readFileSync(GLOBALS_CSS, "utf8");

describe("light-theme palette overrides", () => {
	it("finds the light block and some palette usage", () => {
		// Both halves of every assertion below come from parsing; if either
		// stops matching, the rest would pass vacuously.
		expect(lightBlock(css).length).toBeGreaterThan(200);
		expect(usedPaletteShades().size).toBeGreaterThan(10);
	});

	it("covers every mid and light shade the app actually uses", () => {
		const overridden = new Set(
			[...lightBlock(css).matchAll(/--color-([a-z]+-\d+)\s*:/g)].map(
				(match) => match[1] as string,
			),
		);

		const missing = [...usedPaletteShades()]
			.filter((shade) => {
				const number = Number(shade.split("-")[1]);
				return !SHADES_NEEDING_NO_OVERRIDE.has(number);
			})
			.filter((shade) => !overridden.has(shade))
			.sort();

		// If this fails, add the listed shades to the `:root.light` block in
		// globals.css, two steps darker than stock (300/400/500 -> 600, 600 -> 700).
		expect(missing).toEqual([]);
	});

	it("leaves the dark theme's palette completely alone", () => {
		// The whole safety argument: with no override in the default block, the
		// dark theme renders Tailwind's stock palette, which is what it renders
		// today. Adding one here would silently restyle the app.
		const defaultBlock = css.match(/^:root\s*\{([\s\S]*?)\n\}/m)?.[1] ?? "";
		expect(defaultBlock.length).toBeGreaterThan(200);
		expect(defaultBlock).not.toMatch(
			/--color-(red|amber|emerald|green)-\d+\s*:/,
		);
	});
});
