# Liquid Glass — a second skin for GatedSpace

**Status:** plan only. Nothing built. Approved previews this is based on:

- `20260818-gatedspace-restyle-v3.html` — the full window, the goal shot
- `20260818-gatedspace-panes-1-and-2.html` — one pane, and two side by side
- `20260818-ui-batch-preview.html` — the 1.17.48 batch already shipped

Reference: BridgeMind One's Code view (his screenshots, 2026-08-18).

---

## 1. What this actually is

Two named appearances, chosen in **Settings → Appearance**:

| Skin | What it is |
|---|---|
| **VS Code Style** | Exactly what 1.17.48 ships today. Edge-to-edge mosaic panes, presets on their own row, account in the top bar. The fallback. |
| **Liquid Glass** | Floating cards with gutters and radius, presets merged into a centred header control, restructured sidebar with nested sessions and a pinned footer. |

**VS Code Style stays the default.** Public builds see no change unless someone opts in,
and he can flip his own copy once and forget it.

## 2. The mechanism, and why not just CSS

A pure CSS-variable theme cannot do this. Liquid Glass moves a whole row (the presets bar)
into the header and moves the account from the top bar to the sidebar footer. That is
structure, not colour.

But branching every component on `skin === "liquid-glass"` spreads the skin through the
codebase and makes it impossible to test one change at a time.

**So: a token layer.** One hook, `useSkinTokens()`, returns a flat object. Components read
tokens, never the skin name:

```ts
interface SkinTokens {
  paneGap: number;              // 0  | 14
  paneRadius: number;           // 0  | 11
  paneElevation: boolean;       // false | true
  presetsPlacement: "row" | "header";
  accountPlacement: "topbar" | "sidebar-footer";
  sidebarNav: "icons" | "text";
  sidebarSessions: boolean;     // nested live sessions with counts
  sidebarFooterRows: boolean;   // "Right sidebar", "Spend today"
  promptAccentBar: boolean;
  messageTimestamps: boolean;
  hintBar: "never" | "focused";
}
```

Three reasons this is worth the extra indirection:

1. **Each token is independently revertible.** If gutters break a terminal pane, `paneGap`
   goes back to 0 without touching the other nine.
2. **Each token is independently testable.** A test asserts behaviour per token value, not
   per skin, so adding a third skin later costs nothing.
3. **It keeps the skin honest.** Anything that cannot be expressed as a token is probably a
   feature, not an appearance — see §3.

## 3. Skin vs feature — the split that keeps scope sane

Several things in the previews are NOT appearance. They are features both skins should get,
and gating them on a skin would mean building each twice or hiding them arbitrarily.

**Skin (Liquid Glass only):**
gutters · radius · card elevation · merged header control · sidebar restructure · account
placement · prompt accent bar · timestamps · focused-only hint bar

**Feature (both skins):**

| Feature | Why it is not a skin |
|---|---|
| **Tidy** — reflow panes to an even grid | Useful in the current mosaic too. It fixes lopsided splits, which is a today problem. |
| **Launch more than one…** | How you get N agents without N manual splits. Nothing to do with looks. |
| **◆ collapsed tool summaries** | Compresses transcript noise at any pane width. |
| **Todo counter in the meta row** | Real information the session already has. |

Building the features first also de-risks the skin: they are the parts most likely to be
wanted regardless of which appearance wins.

## 4. Phases

Each phase is independently shippable and independently revertible.

### Phase 0 — the switch, with both skins identical

Add `appearanceSkin: "vscode" | "liquid-glass"` to `v2UserPreferences` (same place
`rightSidebarEnabled` landed), a `useSkinTokens()` hook, and the Settings → Appearance
picker. Liquid Glass returns the SAME tokens as VS Code Style at this point.

Ship it, flip the toggle, confirm nothing changes. That proves the plumbing without a single
visual regression to debug. Skipping this step is how a skin system becomes undebuggable.

### Phase 1 — chrome (zero xterm risk)

Nothing here touches pane geometry, so nothing here can wake the blank-terminal bug.

- Sidebar: text-only nav rows, nested sessions with status dots and counts, pinned footer
  with "Right sidebar" and "Spend today", account row with the Ultra badge.
- Toolbar: presets merged into a centred segmented control; account moves out to the sidebar.
- Colour and elevation tokens.

**This is most of the visual win and none of the risk.** If the project stops here it still
looks like the preview from the sidebar and toolbar in.

### Phase 2 — the cards (the risky one)

`paneGap: 14`, `paneRadius: 11`, elevation on. The mosaic keeps owning geometry; each leaf
gets an inset padded wrapper and the pane container gets the radius. The active-pane ring is
already an inset overlay written as `rounded-[inherit]`, so it follows for free.

**Gate:** do not start until a plain PowerShell pane is confirmed painting in 1.17.48.
Changing every terminal's pixel box while the 1.17.46 fix is unconfirmed makes a blank pane
undiagnosable — you will not know if it is the old bug or the new padding.

**Mitigation if it does break:** `paneGap` can differ by pane kind. Session panes are DOM and
cost nothing; terminal panes can keep zero gap until the xterm path is trusted.

### Phase 3 — transcript detail

Prompt accent bar and timestamp, message timestamps, focused-only hint bar, meta row layout.
All inside `SessionTimelineView`. No layout risk.

### Phase 4 — the shared features

Tidy, launch-more-than-one, ◆ summaries, todo counter. Available in both skins.

## 5. Files, by phase

| Phase | Files |
|---|---|
| 0 | `dashboardSidebarLocal/schema.ts`, `useV2UserPreferences`, new `renderer/hooks/useSkinTokens/`, `AppearanceSettings` + new `SkinSection` |
| 1 | `DashboardSidebar/*`, `TopBar/TopBar.tsx`, `V2PresetsBar` (becomes header-embeddable), `OrganizationDropdown` (placement) |
| 2 | `packages/panes` `Tab.tsx` (leaf wrapper), `Pane.tsx` (radius) |
| 3 | `ClaudeSessionPane/SessionTimelineView.tsx` |
| 4 | new `TidyAction`, `WorkspaceEmptyState`, `SessionTimelineView` |

## 6. Risks

| Risk | Severity | Handling |
|---|---|---|
| Gutters wake the blank-terminal bug | **High** | Phase 2 gated on confirming .48. Per-kind gap as the escape hatch. |
| Two code paths double the surface to test | Medium | Tokens, not skin names, so tests are per-token. Existing suite must stay at the 55-fail baseline. |
| `packages/panes` is a shared package | Medium | Tokens passed in as props from the desktop app; the package never learns what a "skin" is. |
| Presets cap at ~5 in the header | Low | Open question, §7. |
| Skin ships to the public repo | Low | Default is VS Code Style; public users see today's app. |

## 7. Open questions — need answers before Phase 1

1. **"Liquid Glass" implies actual glass.** The previews are flat cards with subtle
   elevation — no blur, no translucency. Real frosted glass (`backdrop-filter`) is a
   different look and a real GPU cost in Electron. Which is wanted: the preview as approved,
   or actual translucency?
2. **More than five presets.** Merging them into the header caps what fits. If he routinely
   pins more than five they need to scroll or collapse to "+N" — or the presets bar stays a
   row and is merely centred.
3. **Should Liquid Glass be his default** once it exists, with VS Code Style as the fallback?

## 8. Definition of done

- [ ] Toggling in Settings → Appearance switches skins live, no reload
- [ ] VS Code Style is pixel-identical to 1.17.48
- [ ] Liquid Glass matches `restyle-v3` and `panes-1-and-2` at 1440×900
- [ ] A plain PowerShell pane paints in both skins
- [ ] `bun test apps/desktop` at or below the 55-fail baseline
- [ ] `bun run lint` clean, `bun run typecheck` clean
- [ ] Preview HTML for the Settings picker itself, opened in Chrome
- [ ] 1.17.48 installer kept as the rollback point for the pre-skin app
