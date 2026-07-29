import type { Theme } from "../types";

/**
 * Koi, from BridgeSpace's theme table.
 *
 * A warm near-black — the background is #211719, which carries red rather than
 * the blue most dark themes lean on — with a single bright vermilion accent
 * (#FF3131). The surfaces climb through browns (#281E20 → #4D4547), so panels
 * separate by warmth instead of by brightness.
 *
 * Every hex here is theirs, read from the same bundled table as Dracula.
 *
 * With one honest gap. Their bundle interns each string once, so a theme that
 * reuses an earlier theme's value simply has no entry — Koi's table carries a
 * background, an accent, six surfaces and its muted greys, and nothing else.
 * Its foreground and syntax colours were interned earlier, almost certainly
 * from Dracula, which sits first in the table. Those are taken from there and
 * marked below. If any look wrong in use, that inference is the thing to
 * doubt, not the values above it.
 */
export const koiTheme: Theme = {
	id: "koi",
	name: "Koi",
	author: "BridgeMind",
	type: "dark",
	isBuiltIn: true,
	description: "Warm near-black with a vermilion accent",

	ui: {
		background: "#211719",
		// Inherited (see the note above), not read from Koi's own entry.
		foreground: "#e4e4e0",
		card: "#281e20",
		cardForeground: "#e4e4e0",
		popover: "#2c2325",
		popoverForeground: "#e4e4e0",
		primary: "#ff3131",
		primaryForeground: "#211719",
		secondary: "#2c2325",
		secondaryForeground: "#e4e4e0",
		muted: "#2c2325",
		mutedForeground: "#a6a2a3",
		accent: "#382f30",
		accentForeground: "#e4e4e0",
		tertiary: "#211719",
		tertiaryActive: "#2c2325",
		// The accent IS red here, so destructive shares it rather than
		// introducing a second, near-identical red that would only ever look
		// like a mistake next to it.
		destructive: "#ff3131",
		destructiveForeground: "#211719",
		border: "#3c3335",
		input: "#3c3335",
		ring: "#ff3131",
		sidebar: "#211719",
		sidebarForeground: "#e4e4e0",
		sidebarPrimary: "#ff3131",
		sidebarPrimaryForeground: "#211719",
		sidebarAccent: "#2c2325",
		sidebarAccentForeground: "#e4e4e0",
		sidebarBorder: "#281e20",
		sidebarRing: "#ff3131",
		chart1: "#ff3131",
		chart2: "#50fa7b",
		chart3: "#8be9fd",
		chart4: "#f1fa8c",
		chart5: "#bd93f9",

		highlightMatch: "rgba(255, 49, 49, 0.280)",
		highlightActive: "rgba(255, 49, 49, 0.350)",

		highlight: "#ff3131",
		highlightForeground: "#211719",

		// Inherited. Koi's own entry carries no green, yellow or cyan.
		success: "#50fa7b",
		successForeground: "#211719",
		warning: "#f1fa8c",
		warningForeground: "#211719",
		info: "#8be9fd",
		infoForeground: "#211719",
	},

	terminal: {
		background: "#211719",
		foreground: "#e4e4e0",
		cursor: "#ff3131",
		cursorAccent: "#211719",
		selectionBackground: "rgba(60, 51, 53, 0.6)",

		// Inherited ANSI. Koi defines no syntax colours of its own; black and
		// white are pulled onto its own background and foreground so the
		// terminal does not sit on a different dark than the app does.
		black: "#211719",
		red: "#ff3131",
		green: "#50fa7b",
		yellow: "#f1fa8c",
		blue: "#bd93f9",
		magenta: "#ff79c6",
		cyan: "#8be9fd",
		white: "#e4e4e0",

		brightBlack: "#7a7475",
		brightRed: "#ff6e6e",
		brightGreen: "#69ff94",
		brightYellow: "#ffffa5",
		brightBlue: "#d6acff",
		brightMagenta: "#ff92df",
		brightCyan: "#a4ffff",
		brightWhite: "#ffffff",
	},
};
