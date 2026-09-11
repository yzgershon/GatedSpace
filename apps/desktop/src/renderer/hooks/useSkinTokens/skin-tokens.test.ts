import { describe, expect, it } from "bun:test";
import {
	LIQUID_GLASS_TOKENS,
	resolveSkinTokens,
	type SkinTokens,
	VSCODE_TOKENS,
} from "./skin-tokens";

describe("resolveSkinTokens", () => {
	it("maps each skin to its token set", () => {
		expect(resolveSkinTokens("vscode")).toBe(VSCODE_TOKENS);
		expect(resolveSkinTokens("liquid-glass")).toBe(LIQUID_GLASS_TOKENS);
	});
});

describe("token sets", () => {
	/**
	 * The reason "VS Code Style" exists at all: it must reproduce what shipped
	 * through 1.17.48. Edge-to-edge panes with no radius, presets on their own
	 * row, account in the top bar. If any of these drift, the escape hatch stops
	 * being an escape hatch.
	 */
	it("keeps VS Code Style as the pre-skin layout", () => {
		expect(VSCODE_TOKENS.paneGap).toBe(0);
		expect(VSCODE_TOKENS.paneRadius).toBe(0);
		expect(VSCODE_TOKENS.paneElevated).toBe(false);
		expect(VSCODE_TOKENS.paneSurface).toBe("flush");
		expect(VSCODE_TOKENS.presetsPlacement).toBe("row");
		expect(VSCODE_TOKENS.accountPlacement).toBe("topbar");
		expect(VSCODE_TOKENS.sidebarRail).toBe(true);
		expect(VSCODE_TOKENS.topBarSurface).toBe("bar");
		expect(VSCODE_TOKENS.sidebarCollapse).toBe("rail");
		expect(VSCODE_TOKENS.sidebarNav).toBe("icons");
		expect(VSCODE_TOKENS.sidebarSessions).toBe(false);
		expect(VSCODE_TOKENS.tabStrip).toBe("bar");
		expect(VSCODE_TOKENS.shellChrome).toBe("sidebar");
		expect(VSCODE_TOKENS.paneBorder).toBe(true);
		expect(VSCODE_TOKENS.sidebarSurface).toBe("flush");
		expect(VSCODE_TOKENS.themeControl).toBe("toggle");
		expect(VSCODE_TOKENS.composer).toBe("panel");
		expect(VSCODE_TOKENS.metaStrip).toBe("full");
		expect(VSCODE_TOKENS.transcriptGutter).toBe(false);
		expect(VSCODE_TOKENS.hintBar).toBe("never");
	});

	it("gives Liquid Glass floating cards and a merged header", () => {
		expect(LIQUID_GLASS_TOKENS.paneGap).toBeGreaterThan(0);
		expect(LIQUID_GLASS_TOKENS.paneRadius).toBeGreaterThan(0);
		expect(LIQUID_GLASS_TOKENS.paneSurface).toBe("raised");
		expect(LIQUID_GLASS_TOKENS.presetsPlacement).toBe("header");
		expect(LIQUID_GLASS_TOKENS.accountPlacement).toBe("sidebar-footer");
		expect(LIQUID_GLASS_TOKENS.sidebarRail).toBe(false);
		expect(LIQUID_GLASS_TOKENS.topBarSurface).toBe("floating");
		expect(LIQUID_GLASS_TOKENS.sidebarCollapse).toBe("hidden");
		expect(LIQUID_GLASS_TOKENS.sidebarNav).toBe("text");
		expect(LIQUID_GLASS_TOKENS.tabStrip).toBe("switcher");
		expect(LIQUID_GLASS_TOKENS.shellChrome).toBe("topbar");
		expect(LIQUID_GLASS_TOKENS.paneBorder).toBe(false);
		expect(LIQUID_GLASS_TOKENS.sidebarSurface).toBe("card");
		expect(LIQUID_GLASS_TOKENS.themeControl).toBe("menu");
		expect(LIQUID_GLASS_TOKENS.composer).toBe("inline");
		expect(LIQUID_GLASS_TOKENS.metaStrip).toBe("none");
		expect(LIQUID_GLASS_TOKENS.transcriptGutter).toBe(true);
		expect(LIQUID_GLASS_TOKENS.hintBar).toBe("focused");
	});

	/**
	 * A sidebar card and a pane card share `--gs-pane-radius` and
	 * `--gs-pane-inset`, so a rounded sidebar against square panes (or the
	 * reverse) is the mismatch this skin exists to remove.
	 */
	it("only makes the sidebar a card when panes are cards too", () => {
		for (const tokens of [VSCODE_TOKENS, LIQUID_GLASS_TOKENS]) {
			if (tokens.sidebarSurface === "card") {
				expect(tokens.paneSurface).toBe("raised");
				expect(tokens.paneRadius).toBeGreaterThan(0);
			}
		}
	});

	/**
	 * A raised pane needs the border and the gutter that separate it from the
	 * well; without them it is a lighter rectangle bleeding into its neighbour.
	 */
	it("only raises a pane that is also elevated and inset", () => {
		for (const tokens of [VSCODE_TOKENS, LIQUID_GLASS_TOKENS]) {
			if (tokens.paneSurface === "raised") {
				expect(tokens.paneElevated).toBe(true);
				expect(tokens.paneGap).toBeGreaterThan(0);
			}
		}
	});

	/**
	 * A gap with no radius reads as a bug rather than a style, and a radius with
	 * no gap clips against the neighbouring pane. They travel together.
	 */
	it("never has a gap without a radius, or the reverse", () => {
		for (const tokens of [VSCODE_TOKENS, LIQUID_GLASS_TOKENS]) {
			expect(tokens.paneGap > 0).toBe(tokens.paneRadius > 0);
		}
	});

	/**
	 * The invariant behind the collapse glitch: collapsing must not be the one
	 * moment a rail-less skin grows a rail. This is the assertion that would
	 * have caught `sidebarRail || isCollapsed`.
	 */
	it("never collapses to a rail the skin does not have", () => {
		for (const tokens of [VSCODE_TOKENS, LIQUID_GLASS_TOKENS]) {
			if (tokens.sidebarCollapse === "rail") {
				expect(tokens.sidebarRail).toBe(true);
			}
		}
	});

	/** Every key is set in both, so neither can silently inherit a default. */
	it("defines the same keys in both skins", () => {
		const keys = (t: SkinTokens) => Object.keys(t).sort();
		expect(keys(VSCODE_TOKENS)).toEqual(keys(LIQUID_GLASS_TOKENS));
	});

	it("differs on every decision that has two sides", () => {
		// If a token ever matched across both skins it would belong in the base
		// styling instead of here.
		const differing = (
			Object.keys(VSCODE_TOKENS) as (keyof SkinTokens)[]
		).filter((key) => VSCODE_TOKENS[key] !== LIQUID_GLASS_TOKENS[key]);
		expect(differing.length).toBe(Object.keys(VSCODE_TOKENS).length);
	});
});
