# Floating groups — replacing the tab architecture

**Status: plan + preview. Nothing is coded.** Preview:
`20260822-floating-groups-preview.html`.

Asked for on 2026-08-22: floating tabs that collapse to tokens and expand on
hover, living between the agent presets and the open-in button, with the group
pill deleted and tabs separated from the workspace.

---

## What is actually wrong today

Three separate problems, and it matters that they are separate because only one
of them is about how tabs look.

**1. A group is not reachable, it is remembered.** Under Liquid Glass the tab
strip is gone and the only affordance is the pill in the top left, which shows
ONE name and a chevron. Every other group is behind a click. There is no
at-a-glance answer to "what else is open", which is the entire job a tab strip
does, so the pill traded the answer for the space.

**2. A tab cannot exist without a workspace.** `useV2WorkspacePaneLayout`
builds the store with `useMemo([workspaceId])` — a NEW store per workspace — and
persists `{version, tabs, activeTabId}` into `v2WorkspaceLocalState.paneLayout`
keyed by workspace id. So tabs are a FIELD OF a workspace. Switching workspace
swaps the entire tab set, and there is no way to have one group on this repo and
one on another and see both.

That per-workspace scoping is deliberate and load-bearing: the comment on it
says sharing a store across a fast workspace switch let panes from one worktree
render and persist under another. Any change here has to keep that property by
some other means.

**3. The strip and the pill are two implementations of one idea.**
`TabBar`/`TabItem` render under `tabStrip: "bar"`, `GroupSwitcher` under
`"switcher"`, and the per-pane hover card + `getTabIcon` — implemented for all
eight pane kinds — live only in `TabItem`, so they are dead code under the skin
he actually runs.

---

## Two changes, shipped separately

They are separable, and separating them is the whole point. One is a component.
The other is the riskiest change in the app.

### Phase 1 — the floating strip (visual, low risk)

A new `GroupStrip` in the top bar, portaled from the workspace page the same way
the presets and the shells chip already are. Replaces `GroupSwitcher` and the
`workspace-topbar-groups-slot` pill outright.

- **Active group is expanded**: status dot, agent mark, name, pane count, close.
- **Every other group is a token**: a 30px capsule with the mark and its dot.
- **Hover a token and it expands in place** to its full name. Only the hovered
  one moves; the rest hold, so the strip does not ripple.
- **`+` at the end** makes an undecided group, the same launcher pane `+`
  already makes.
- **The strip is a drop target**, because it must be. Dragging a pane onto empty
  strip space is the only one-gesture way to give a pane its own group, and the
  pill carries that today via `PANE_DRAG_TYPE`. Deleting the pill without
  keeping this deletes the gesture.
- **Double-click a group renames it**, for the same reason — the pill is where
  the strip's rename went when the strip was removed.

Everything in `TabItem` that Liquid Glass cannot currently reach comes with it:
the per-pane rows, `getTabIcon` for all eight kinds, and the hover card, which
becomes the expanded token's second row.

**This ships on its own and needs no data changes.** Groups stay per-workspace.

### Phase 2 — groups above workspaces (architecture, high risk)

Today the workspace owns the groups. Invert it: **the group owns a workspace.**

    // now
    v2WorkspaceLocalState[workspaceId].paneLayout = { tabs, activeTabId }

    // proposed
    paneLayout = { groups: [ { id, workspaceId, panes, layout } ], activeGroupId }

- One store for the whole app instead of one per route.
- `workspaceId` stops being the container and becomes a field on the group.
- Clicking a group in the strip switches the route to that group's workspace AND
  activates the group, in that order.
- The sidebar tree keeps working — it already reads `session-activity`, a
  module-level registry keyed by pane id, not the pane store.

**What this buys:** a group on SecondBrain and a group on superset, both visible
in one strip, switchable without losing either.

**What it costs, and this is the part to weigh.** The per-workspace store is the
guard that stops a pane rendering against the wrong worktree. Remove it and that
guard has to be rebuilt explicitly: every pane must resolve its workspace from
`group.workspaceId` and never from the route. Get it wrong and a session runs in
the wrong directory, or two panes attach one session id — which is exactly the
7/18 and 7/19 transcript loss.

So Phase 2 carries, non-negotiably:

1. **A migration** from the per-workspace layouts into one, run once, with the
   old rows left in place until it is confirmed.
2. **`workspaceId` threaded from the group** into `usePaneRegistry`,
   `ClaudeSessionPane`, and the terminal launcher, replacing every read of the
   route's workspace.
3. **The host-side mismatch check kept as the backstop.**
   `getTerminalWorkspaceMismatchError` already refuses a terminal whose
   workspace does not match; that stops being a formality and becomes the thing
   that catches a threading mistake.
4. **A test that a pane's resolved workspace is its group's**, not the route's.

---

## What gets deleted

| Deleted | Why it is safe |
|---|---|
| `GroupSwitcher` + `workspace-topbar-groups-slot` | The strip shows every group at once; the pill showed one |
| `TabBar` / `TabItem` / `showTabBar` | One strip for both skins. `tabStrip` token retires with it |
| The `AddTabMenu` remnants | `+` makes an undecided group; nothing is chosen up front |

---

## Open questions — answer these before Phase 2 is scoped

1. **Does a group belong to one workspace, or can its panes span workspaces?**
   One workspace per group is far simpler and matches how you work. Panes
   spanning workspaces inside one group means per-pane workspace resolution
   everywhere, and I would not do it without a reason.
2. **Do groups survive switching projects entirely, or are they per project?**
   App-wide is the simple answer, but eight groups across four repos in one
   strip is a lot of tokens.
3. **What happens to a group whose workspace is deleted?** Options: drop the
   group, or keep it and grey it out until the worktree comes back.

---

## Order I would build in

1. Phase 1 strip, behind nothing — it replaces the pill directly.
2. Live on it for a few days. The hover-expand is the part most likely to feel
   wrong at 6+ groups, and no preview settles that.
3. Then Phase 2, with the migration and the workspace-threading test first, not
   last.
