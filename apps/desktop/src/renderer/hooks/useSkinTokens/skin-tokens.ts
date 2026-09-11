/**
 * What an appearance actually resolves to.
 *
 * Components read TOKENS, never the skin name. That indirection is the whole
 * point of this file, and it buys three things:
 *
 *  - Any single decision can be reverted on its own. If gutters turn out to
 *    upset a terminal pane, `paneGap` goes back to 0 without disturbing the
 *    other tokens or unpicking the skin.
 *  - Tests assert per token rather than per skin, so a third appearance costs
 *    nothing to test.
 *  - It keeps the split honest. Anything that cannot be expressed here is a
 *    FEATURE, not an appearance — Tidy, "launch more than one" — and those
 *    belong to both skins rather than being gated behind one of them.
 *
 * One rule holds the file together, and there is a test for it: EVERY token
 * differs between the two skins. A token that matched on both sides would be
 * base styling wearing a costume, and belongs in the component instead.
 */
import type { AppearanceSkin } from "renderer/hooks/useV2UserPreferences";

export interface SkinTokens {
	/** Gutter between panes, in px. 0 tiles them edge to edge. */
	paneGap: number;
	/** Corner radius on a pane, in px. */
	paneRadius: number;
	/** Whether a pane sits on its own surface with a shadow. */
	paneElevated: boolean;
	/**
	 * A hairline around each card, and down the sidebar's edge.
	 *
	 * Needed while the card shared the app's background and had nothing but the
	 * line to describe its shape. With the card lifted above a recessed trough
	 * the line is a SECOND boundary drawn over one that already reads, which is
	 * the "thin gray lines between everything" he kept pointing at.
	 */
	paneBorder: boolean;
	/**
	 * Whether a pane paints its own surface a step LIGHTER than the app behind
	 * it, or shares the app background.
	 *
	 * This is the one that makes cards read as cards. A gutter and a radius on a
	 * surface that never lifts is a rounded region, not a raised one — the card
	 * has to win the lightness contest against the well or the whole effect
	 * collapses, which is exactly what 1.17.50 shipped.
	 */
	paneSurface: "flush" | "raised";
	/**
	 * Focus ring thickness, in px. With bordered cards a thick ring plus its
	 * bloom reads as a glowing frame rather than "this one has focus", so the
	 * card layout brightens the existing border instead of drawing over it.
	 */
	paneRingWidth: number;
	/** Soft bloom just inside the ring, in px. 0 turns it off. */
	paneRingGlow: number;
	/**
	 * Actions in a pane's header. "full" adds the maximize control, which is how
	 * you get from a grid to one pane and back without touching the layout.
	 */
	paneHeaderActions: "minimal" | "full";
	/** A live status dot at the head of a pane's title row. */
	paneHeaderStatus: boolean;
	/**
	 * Where the agent presets live. "row" is a strip of its own under the top
	 * bar; "header" merges them into the top bar as a centred segmented
	 * control, which reclaims ~36px of vertical space.
	 */
	presetsPlacement: "row" | "header";
	/**
	 * How you move between tab GROUPS.
	 *
	 * "bar" is the strip along the top of the workspace, one slab per group.
	 * "switcher" removes the strip and puts a single pill in the top bar naming
	 * the group you are in, which opens the list.
	 *
	 * The strip charges a permanent 40px row for a control that answers a
	 * question you ask rarely, and it truncates to about 13 characters, so with
	 * more than a few groups it is a row of prefixes. The pill charges nothing
	 * and shows the full name.
	 *
	 * Anything that could be DROPPED on the strip has to be droppable on the
	 * pill instead — dragging a pane out to its own group is the gesture that
	 * would otherwise be lost with it.
	 */
	tabStrip: "bar" | "switcher";
	/**
	 * Where the app's own chrome lives: the name, the build, the collapse
	 * toggle.
	 *
	 * "sidebar" is the 1.17.48 arrangement, where the sidebar runs the full
	 * height of the window beside the top bar and carries the brand row itself.
	 * "topbar" puts all of it in the top bar and drops the sidebar BELOW that
	 * bar, so the sidebar card and the pane cards start at the same y and read
	 * as one row of cards rather than as two systems.
	 */
	shellChrome: "sidebar" | "topbar";
	/**
	 * Whether the sidebar is a flush wall or a floating card like the panes.
	 *
	 * A rounded pane against a square-cornered sidebar reads as two unrelated
	 * systems sharing a window. Either everything floats or nothing does.
	 */
	sidebarSurface: "flush" | "card";
	/**
	 * A one-click light/dark flip, or a menu of every installed theme.
	 *
	 * A moon icon promises a binary that does not exist here — there are far
	 * more than two themes, and the one in use is neither "light" nor "dark".
	 */
	themeControl: "toggle" | "menu";
	/**
	 * Whether the title bar is a SURFACE or floats on the well.
	 *
	 * "bar" fills it and rules it off from the content below, which is what a
	 * toolbar looks like. "floating" gives it neither, so the brand, the
	 * launcher, the tab rail and the window controls sit directly on the same
	 * ground the pane cards float on — the row stops being a strip and becomes
	 * a set of objects at the top of the window.
	 *
	 * A filled bar under floating cards is the same mismatch the pane borders
	 * were: one element saying "panel" while everything around it says "card".
	 */
	topBarSurface: "bar" | "floating";
	/** Breadcrumb of every scope, or workspace name first with branch trailing. */
	topBarTitle: "breadcrumb" | "workspace-first";
	/** Top bar, or pinned to the bottom of the sidebar. */
	accountPlacement: "topbar" | "sidebar-footer";
	/** The 48px activity rail beside the sidebar panel. */
	sidebarRail: boolean;
	/**
	 * What collapsing the sidebar leaves behind.
	 *
	 * "rail" keeps the 48px activity rail as the thing you click to come back.
	 * "hidden" closes it to nothing, and is only safe because the toggle lives
	 * in the top bar under that chrome — see `shellChrome`.
	 *
	 * This exists because `sidebarRail: false` was being overridden by a
	 * `|| isCollapsed` in DashboardSidebar, so collapsing under Liquid Glass
	 * resurrected the very rail the skin removes, cropped into 48px. A skin that
	 * has no rail must not grow one on collapse.
	 */
	sidebarCollapse: "rail" | "hidden";
	/** Icon-led nav rows, or text-only ones. */
	sidebarNav: "icons" | "text";
	/** Nest a workspace's live sessions beneath it, with status dots. */
	sidebarSessions: boolean;
	/** "Right sidebar", "Spend today" rows above the account. */
	sidebarFooterRows: boolean;
	/** A vertical accent rule down the left edge of a turn's prompt. */
	promptAccentBar: boolean;
	/**
	 * A left rail of status dots down the transcript, one per step.
	 *
	 * The reference's signature: green done, amber running, red failed, grey
	 * prose. Without it a transcript is a wall with no scan line.
	 */
	transcriptGutter: boolean;
	/** Fold consecutive tool calls into one `◆ …` line with a hook count. */
	toolSummaries: boolean;
	/** Clock time against prompts and assistant replies. */
	messageTimestamps: boolean;
	/**
	 * The second row under a pane's title.
	 *
	 * "none" removes it: the folder moved up into the title row and the token
	 * fraction moved into the composer, which is everything worth keeping from
	 * a strip that also carried the account, two usage meters, a reset time
	 * with a timezone, a dollar total and an MCP count — over every pane.
	 */
	metaStrip: "full" | "none";
	/**
	 * Whether the working line carries `[stop]`.
	 *
	 * The line itself was already the reference's shape — animated mark, a
	 * gerund that types itself in, elapsed, and a token delta. What it had no
	 * way to do was END the turn, because Stop lived on the composer's toolbar,
	 * and the inline composer has no toolbar.
	 */
	statusLine: "terse" | "rich";
	/** A capped floating panel, or one inline row as wide as the transcript. */
	composer: "panel" | "inline";
	/**
	 * Where the `Shift+Tab:mode | Esc:cancel` strip appears.
	 *
	 * "focused" rather than "always" on purpose: repeated under every pane it is
	 * the same sentence four times over, in the space the transcript wants.
	 */
	hintBar: "never" | "focused";
}

/** The layout GatedSpace shipped through 1.17.48. The way back. */
export const VSCODE_TOKENS: SkinTokens = {
	paneGap: 0,
	paneRadius: 0,
	paneElevated: false,
	paneBorder: true,
	paneSurface: "flush",
	paneRingWidth: 2,
	paneRingGlow: 5,
	paneHeaderActions: "minimal",
	paneHeaderStatus: false,
	presetsPlacement: "row",
	tabStrip: "bar",
	shellChrome: "sidebar",
	sidebarSurface: "flush",
	themeControl: "toggle",
	topBarSurface: "bar",
	topBarTitle: "breadcrumb",
	accountPlacement: "topbar",
	sidebarRail: true,
	sidebarCollapse: "rail",
	sidebarNav: "icons",
	sidebarSessions: false,
	sidebarFooterRows: false,
	promptAccentBar: false,
	transcriptGutter: false,
	toolSummaries: false,
	messageTimestamps: false,
	metaStrip: "full",
	statusLine: "terse",
	composer: "panel",
	hintBar: "never",
};

/** Cards with gutters, a merged header, and a restructured sidebar. */
export const LIQUID_GLASS_TOKENS: SkinTokens = {
	paneGap: 18,
	/*
	 * 8px, matching the WINDOW's own corner radius rather than exceeding it.
	 *
	 * Windows 11 rounds a top-level window through DWM, and DWM offers exactly
	 * two radii — `ROUND` (8px) and `ROUNDSMALL` (4px). There is no API for an
	 * arbitrary one, and the only way to draw a 12px window corner is a
	 * transparent frameless window with CSS rounding, which costs the native
	 * drop shadow and breaks maximise. So the cards come to the window instead
	 * of the window coming to the cards, and the two now agree.
	 */
	paneRadius: 8,
	paneElevated: true,
	paneBorder: false,
	paneSurface: "raised",
	paneRingWidth: 1,
	paneRingGlow: 0,
	paneHeaderActions: "full",
	paneHeaderStatus: true,
	presetsPlacement: "header",
	tabStrip: "switcher",
	shellChrome: "topbar",
	sidebarSurface: "card",
	themeControl: "menu",
	topBarSurface: "floating",
	topBarTitle: "workspace-first",
	accountPlacement: "sidebar-footer",
	sidebarRail: false,
	sidebarCollapse: "hidden",
	sidebarNav: "text",
	sidebarSessions: true,
	sidebarFooterRows: true,
	promptAccentBar: true,
	transcriptGutter: true,
	toolSummaries: true,
	messageTimestamps: true,
	metaStrip: "none",
	statusLine: "rich",
	composer: "inline",
	hintBar: "focused",
};

export function resolveSkinTokens(skin: AppearanceSkin): SkinTokens {
	return skin === "vscode" ? VSCODE_TOKENS : LIQUID_GLASS_TOKENS;
}
