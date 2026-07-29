import type { Theme } from "../types";

/**
 * Dracula, as BridgeSpace ships it.
 *
 * The hex values are THEIRS, read out of their bundled theme table rather than
 * eyedropped from a screenshot or copied from canonical Dracula. Their version
 * differs from the canonical palette in ways that matter:
 *
 *  - Foreground is #E4E4E0, not Dracula's #F8F8F2. Warmer and a touch dimmer;
 *    it is why their UI text reads softer than a stock port.
 *  - The surfaces are their own ramp (#2F303C → #52535C) rather than Dracula's
 *    single #44475A, which is what gives their panels depth.
 *  - Pink is the accent, not purple. Purple survives as a chart colour.
 *
 * What is NOT theirs is the mapping of value to role: their bundle is minified
 * and the field names are gone, so which slot each colour filled had to be
 * inferred from the ordering, which is consistent across all nine of their
 * themes. Colours exact, assignments reasoned.
 *
 * Their table has nothing darker than the background, so the sidebar sits on
 * the same colour as the content rather than below it — the opposite of what
 * the screenshots suggested to me, and the reason to go and read the values.
 */
export const draculaTheme: Theme = {
	id: "dracula",
	name: "Dracula",
	author: "Zeno Rocha",
	type: "dark",
	isBuiltIn: true,
	description: "The classic purple-and-pink dark theme",

	ui: {
		background: "#282a36",
		foreground: "#e4e4e0",
		card: "#2f303c",
		cardForeground: "#e4e4e0",
		popover: "#333540",
		popoverForeground: "#e4e4e0",
		primary: "#ff79c6",
		// Dark on pink: #ff79c6 is far too bright to carry light text.
		primaryForeground: "#282a36",
		secondary: "#333540",
		secondaryForeground: "#e4e4e0",
		muted: "#333540",
		mutedForeground: "#a5a6a7",
		accent: "#3d3f49",
		accentForeground: "#e4e4e0",
		tertiary: "#282a36",
		tertiaryActive: "#333540",
		destructive: "#ff5555",
		destructiveForeground: "#282a36",
		border: "#41434d",
		input: "#41434d",
		ring: "#ff79c6",
		sidebar: "#282a36",
		sidebarForeground: "#e4e4e0",
		sidebarPrimary: "#ff79c6",
		sidebarPrimaryForeground: "#282a36",
		sidebarAccent: "#333540",
		sidebarAccentForeground: "#e4e4e0",
		sidebarBorder: "#2f303c",
		sidebarRing: "#ff79c6",
		chart1: "#ff79c6",
		chart2: "#50fa7b",
		chart3: "#8be9fd",
		chart4: "#f1fa8c",
		chart5: "#bd93f9",

		// Their exact opacities. Mine were guesses at 0.22 and 0.5.
		highlightMatch: "rgba(255, 121, 198, 0.280)",
		highlightActive: "rgba(255, 121, 198, 0.350)",

		highlight: "#ff79c6",
		highlightForeground: "#282a36",

		success: "#50fa7b",
		successForeground: "#282a36",
		warning: "#f1fa8c",
		warningForeground: "#282a36",
		info: "#8be9fd",
		infoForeground: "#282a36",
	},

	terminal: {
		background: "#282a36",
		// The terminal keeps Dracula's brighter #f8f8f2 — it appears in their
		// table alongside the dimmer UI foreground, which is the normal split:
		// chrome softens, code does not.
		foreground: "#f8f8f2",
		cursor: "#f8f8f2",
		cursorAccent: "#282a36",
		selectionBackground: "rgba(61, 63, 73, 0.6)",

		// Official Dracula ANSI palette. Published and exact, and their table
		// carries the same cyan, green, yellow, red and purple.
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
	},
};
