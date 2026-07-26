import type { Theme } from "../types";

/**
 * Solarized Light — Schoonover's palette as a starting point, not a contract.
 *
 * It began as the canonical sixteen colours. It isn't any more, and the reasons
 * are worth keeping because each one came from something being unreadable:
 *
 *   - UI surfaces and text were SAMPLED from the reference rendering side by
 *     side. Where the spec and the reference disagreed the reference won, since
 *     matching it is the entire point of this theme.
 *   - Text is a neutral grey, not base00's blue-grey. On cream, neutral reads
 *     warm; the canonical hue looked cold next to the real thing.
 *   - The terminal's ANSI mapping departs furthest — see the note on it below.
 *
 * The spec, for reference when deciding how far a value has drifted:
 *
 *   base03 #002b36   base02 #073642   base01 #586e75   base00 #657b83
 *   base0  #839496   base1  #93a1a1   base2  #eee8d5   base3  #fdf6e3
 *   yellow #b58900   orange #cb4b16   red    #dc322f   magenta #d33682
 *   violet #6c71c4   blue   #268bd2   cyan   #2aa198   green   #859900
 */
export const solarizedLightTheme: Theme = {
	id: "solarized-light",
	name: "Solarized Light",
	author: "Ethan Schoonover",
	type: "light",
	isBuiltIn: true,

	ui: {
		// Every value below is SAMPLED from the reference rendering, side by side
		// at the same scale, not taken from the Solarized spec. Where the two
		// disagree the reference wins — matching it is the point of the theme.
		//
		// The spec would put the surface at base3 and the text at base00. The
		// reference does neither: the pane sits on base2, and the text is a
		// NEUTRAL grey rather than Solarized's blue-grey. On a cream background
		// that neutral reads warm, which is the "more brown" that made mine look
		// wrong even though its hue was the canonical one.
		background: "#eee8d5", // base2
		foreground: "#616161", // neutral, NOT base00 #657b83
		/** Raised surfaces — prompt box, composer, chips. A step darker than base2. */
		card: "#ddd6c1",
		cardForeground: "#616161",
		popover: "#ddd6c1",
		popoverForeground: "#616161",
		primary: "#4f4f4f",
		primaryForeground: "#fdf6e3",
		secondary: "#e4ddc8",
		secondaryForeground: "#616161",
		muted: "#e4ddc8",
		/** Placeholders and secondary labels, sampled off the composer. */
		mutedForeground: "#84908e",
		accent: "#d3cbb7", // sampled off the tab strip; hover/selected rows
		accentForeground: "#4f4f4f",
		tertiary: "#e6e0cc",
		tertiaryActive: "#ddd6c1",
		destructive: "#dc322f", // red
		destructiveForeground: "#fdf6e3",
		// The reference draws NO border on its panels — they're defined purely by
		// fill against the pane. This stays subtle for the rest of the app, which
		// does have real dividers.
		border: "#dcd5c0",
		input: "#dcd5c0",
		// Focus and selection stay in the warm family. Solarized's blue is a
		// legitimate accent in the abstract, but it's the one colour that made this
		// theme read as "not the reference" — a blue ring on a cream panel is the
		// single most out-of-place thing on the screen.
		ring: "#c58f79",
		sidebar: "#eee8d5",
		sidebarForeground: "#616161",
		sidebarPrimary: "#4f4f4f",
		sidebarPrimaryForeground: "#fdf6e3",
		sidebarAccent: "#ddd6c1",
		sidebarAccentForeground: "#4f4f4f",
		sidebarBorder: "#dcd5c0",
		sidebarRing: "#c58f79",

		// Charts walk the accent hues rather than a gradient, so adjacent series
		// stay distinguishable without relying on lightness.
		chart1: "#268bd2", // blue
		chart2: "#2aa198", // cyan
		chart3: "#859900", // green
		chart4: "#b58900", // yellow
		chart5: "#d33682", // magenta

		// Search highlights: yellow and orange at low alpha, so the text under
		// them stays readable instead of being painted over.
		highlightMatch: "rgba(181, 137, 0, 0.25)",
		highlightActive: "rgba(203, 75, 22, 0.45)",

		// Brand highlight — Solarized orange.
		highlight: "#cb4b16",
		highlightForeground: "#fdf6e3",

		success: "#859900", // green
		successForeground: "#fdf6e3",
		warning: "#b58900", // yellow
		info: "#268bd2", // blue
	},

	terminal: {
		background: "#fdf6e3", // base3
		// Neutral rather than base00: the same call as the UI text. A blue-grey
		// at terminal sizes on cream is the least readable thing on screen.
		foreground: "#4f4f4f",
		cursor: "#cb4b16", // orange — the one thing that must never be missed
		cursorAccent: "#fdf6e3",
		selectionBackground: "#ddd6c1",

		/*
		 * DELIBERATELY NOT the canonical Solarized ANSI mapping.
		 *
		 * The spec assigns base02 (#073642) to "black" — near-black, and correct
		 * on a dark background where it reads as a subtle panel. On cream it's a
		 * slab: Codex paints its input row with an ANSI black background, and the
		 * result was a black band across a light terminal.
		 *
		 * So "black" here is the darkest READABLE ink rather than the darkest
		 * colour, and the bright half brightens instead of holding the leftover
		 * greys. That breaks Solarized's symmetry on purpose — the palette exists
		 * to be legible, and a terminal you can't read isn't a faithful one.
		 *
		 * The accents are pulled down from their spec values where the spec's
		 * choice was tuned for a dark ground: green and cyan in particular sit at
		 * far too little contrast against #fdf6e3.
		 */
		black: "#4f4f4f",
		red: "#c0392b",
		green: "#5f7a00",
		yellow: "#a37800",
		blue: "#1f6fa8",
		magenta: "#b02a68",
		cyan: "#1f8378",
		white: "#d9d2bd",

		brightBlack: "#7a7a7a",
		brightRed: "#dc322f",
		brightGreen: "#859900",
		brightYellow: "#b58900",
		brightBlue: "#268bd2",
		brightMagenta: "#d33682",
		brightCyan: "#2aa198",
		brightWhite: "#eee8d5",
	},
};
