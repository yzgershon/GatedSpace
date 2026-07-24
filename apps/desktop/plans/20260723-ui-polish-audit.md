# GatedSpace UI Polish Audit — 2026-07-23

Five-subagent read-only deep dive over the entire UI (left rail, workspace shell +
center panes, right sidebar, chat pane, design-system/global chrome). Nothing has
been changed yet — this is the findings report. Paths relative to repo root;
`R/` = `apps/desktop/src/renderer/`.

Context: Yish uses GatedSpace ~99% of the time inside a workspace with the left
toolbar and right sidebar open. Severity is weighted by visibility in that view.

---

## A. Cross-cutting (found independently by multiple auditors — fix these first)

### A1. [BUG] `dark:` variants follow the OS theme, not the app theme
`R/globals.css` never declares `@custom-variant dark`, so every compiled `dark:*`
utility keys off `prefers-color-scheme` while the app toggles `.dark`/`.light`
classes (`R/stores/theme/utils/css-variables.ts:64-72`). The class-based variant
exists only in `packages/ui/src/globals.css:4`, which the desktop renderer never
imports (`R/index.tsx:21`). 81 `dark:` uses across 37 files are affected.
Symptoms: OpenAI logo `dark:invert` can render black-on-dark (invisible)
(`packages/ui/src/components/ai-elements/model-selector.tsx:176`); PR chips /
checks / comment state colors in the right sidebar show wrong-contrast shades
when OS theme ≠ app theme.
**Fix (one line):** add `@custom-variant dark (&:is(.dark *));` to `R/globals.css`.

### A2. [Major] Hardcoded `bg-[#1b1817]` chrome (breaks light theme)
Near-black hex (one RGB unit off `--tertiary: #1a1716`) that no theme can override:
- `.../WorkspaceSidebar/components/SidebarHeader/SidebarHeader.tsx:28` (segmented track)
- `.../WorkspaceSidebar/components/BrowserTab/BrowserTab.tsx:159` (viewport button)
- `.../WorkspaceSidebar/components/BrowserTab/BrowserTab.tsx:201` (address bar)
**Fix:** `bg-tertiary` (note: `bg-sidebar` token is used 0 times, `bg-tertiary` 4 —
the tokens exist and are nearly dead while chrome hardcodes their value).

Other hex offenders (same class of bug):
- `R/routes/_authenticated/onboarding/components/GhAuthDialog/GhAuthDialog.tsx:33` — `bg-[#151110]`
- `R/screens/main/.../FileViewerContent/FileViewerContent.tsx:406` — `bg-[#0d0d0d]`
- `R/routes/_authenticated/onboarding/providers/components/SupersetIcon/SupersetIcon.tsx:15` — `text-[#eae8e6]` (invisible on light)
- `R/components/Paywall/.../FeaturePreview.tsx:30` — `bg-[#0a0a0f]`; `V1ImportModal/.../WelcomePage.tsx:19` — `bg-[#080a12]` (two different made-up near-blacks for the same treatment)
- `R/routes/.../FontPreview/FontPreview.tsx:63` — `bg-[#1e1e1e] text-[#cccccc] border-[#333]`
- Claude orange `#D97757` duplicated 3× (`onboarding/page.tsx:73`, `ClaudeBrandIcon.tsx:15`, `ClaudeLogo.tsx:13`) → one constant
- `R/globals.css:230-257` — scrollbars hardcoded dark zinc in BOTH themes; `:277-303` `.chat-scrollbar` same → derive from `--muted-foreground`
Total: 23 arbitrary hex utilities in 14 files.

### A3. [Major] `text-destructive-foreground` misused as standalone red text
Resolves to near-white in light theme (invisible on popover) and pale pink `#ffcccc`
in dark. Five spots, all left-rail hover-card area:
- `DashboardSidebarWorkspaceHoverCardContent.tsx:140` (deletions count)
- `PullRequestStatusBadge.tsx:10` (closed pill)
- `ReviewStatus.tsx:17` (changes-requested pill)
- `ChecksSummary.tsx:25` (failure summary)
- `CheckItemRow.tsx:12` (failed check row)
**Fix:** `text-destructive` in all five (`DestroyConfirmPane.tsx:90` does it right).
Rule: `destructive-foreground` only ever sits ON `bg-destructive`.

### A4. [Major] No success/warning/info tokens → 370 raw palette classes in 100 files
"Success" alone renders as `green-500`, `emerald-500`, `emerald-400`, `emerald-600`,
and `green-700` depending on surface. Concrete casualties:
- Run button running state `text-emerald-400` — ~2:1 contrast on light theme
  (`V2WorkspaceRunButton.tsx:76,108`) → minimum `text-emerald-600 dark:text-emerald-400`
- Diff stats styled 3 ways: Changes rows/toolbar `text-green-400`/`text-red-400` + hyphen
  (`ChangesToolbar.tsx:64,68`, `FileRow.tsx:137,141`); left rail `emerald-500/90`/`red-400/90`
  + true minus (`DashboardSidebarWorkspaceDiffStats.tsx:16,21`); Changes tree uncolored
  (`ChangesTreeView.tsx:393-398`)
- Subagent card hardcoded emerald (`SubagentExecutionMessage.tsx:29`)
- Terminal status dots `bg-emerald/amber/red-500` (`TerminalSessionDropdown.tsx:385-388`)
- CommentThread copied-check `text-green-500` no light variant (`CommentThread.tsx:144`)
- v1 StatusIndicator `bg-green-500` vs v2 badges `text-emerald-500` for same state
**Fix:** add `--success(-foreground)`, `--warning`, `--info` to `UIColors` + both themes +
`@theme inline`, then mechanical sweep (emerald/green→success, amber/yellow→warning,
blue→info, red→destructive). The template that already does light/dark right:
`v2-workspace/.../StatusIndicator.tsx:20-26`.

### A5. [Major] Keyboard focus is invisible across most of the app
333 raw `<button className=...>` re-implement hover/radius by hand; the shadcn Button
focus standard (`focus-visible:ring-ring/50 ring-[3px]`) appears in app code exactly
once. No focus style at all on: window controls, pane-header buttons, sidebar
project/section/workspace rows, changes rows, search overlays, ports help button
(which is also `opacity-0 group-hover:opacity-100` — keyboard can focus an invisible
button). Worst raw-button files: `DashboardSidebarHeader.tsx` (12), `BubbleMenuToolbar.tsx`
(7), `DiffToolbar.tsx` (6), `ReviewPanel.tsx`/`CommentsSection.tsx`/`BrowserTab.tsx` (5 each).
**Fix:** sweep toolbars to `Button variant="ghost" size="icon-xs|icon-sm"`; one shared
`focus-ring` utility for the rest.

### A6. [Major] Dead / orphaned UI components (drift factories)
- `DashboardSidebarWorkspaceStatusBadge/` — unreferenced third PR-state styling (left rail)
- `WorkspaceSidebar/components/PRActionHeader/` family (PRActionHeader, PRStatusGroup,
  PRDetailCard, PRStatusIndicators) — imported nowhere; only `utils/computeChecksStatus`
  is live; carries a rose-500 palette (a third red)
- Chat: `PendingQuestionMessage/` and `SubagentExecutionMessage/` fully styled, never
  rendered (`activeSubagents` prop declared `ChatMessageList.types.ts:69`, passed
  `ChatPaneInterface.tsx:938`, never used)
- `ReviewTabContent.tsx:34-56` loading/error/no-PR branches unreachable in current
  composition (`WorkspaceSidebar.tsx:158` + `useReviewTab.tsx:102`)
**Fix:** delete (keep computeChecksStatus utils), or wire in deliberately.

### A7. [Major] Branding + platform leftovers
- "Reveal in **Finder**" on a Windows-only fork — `PathActions.tsx:35-38`,
  `PathActionsMenuItems.tsx:48-51,73-76` (label + error toast) → "File Explorer"
- "Superset" user-facing in settings (`AccountSettings.tsx:165`, `AppearanceSettings.tsx:59`,
  `ExperimentalSettings.tsx:75` "Try Superset v2", `PermissionsSettings.tsx:94`, …)
- Onboarding: "Setup Superset" / "Point Superset at some code" (`onboarding/layout.tsx:24,30`),
  links to docs.superset.sh (`page.tsx:101`)
- `WorkspaceEmptyState.tsx:93` renders the Superset wordmark SVG inside the workspace
  (+ `brightness-0 opacity-75` filter hack for theming)
- Boot screen glow is cool blue `#6ea8fe` on a warm-ember app (`BootScreen.css:6`)
  → `--boot-glow: var(--highlight, #6ea8fe)`

### A8. [Structural] v1/v2 fork is a drift engine
`screens/main/` (160 tsx) vs `v2-workspace/` (137 tsx): 34 duplicated component
basenames, already diverging (status colors, WorkspacesListView text tiers). v1 is
NOT dead — v2's `layout.tsx`, settings, and dashboard still import from it. Any
polish pass must either fix both copies or consciously scope to v2.

---

## B. Left rail (TopBar + DashboardSidebar)

Major:
- Dead separators: `border-b border-border last:border-b-0` on divs that are always
  only-children of their sortable wrappers → border never renders; drag overlay DOES
  draw it, so dragging looks different from resting (`DashboardSidebarProjectSection.tsx:89,:72`,
  `DashboardSidebarCollapsedProjectContent.tsx:44`; overlay `DashboardSidebar.tsx:221`).
  Fix: move to `SortableProjectWrapper` (`DashboardSidebar.tsx:76-83`) or delete all.
- Two selection/hover systems in one rail: header/footer/help use `bg-accent`/`hover:bg-accent/50`;
  all list rows use `bg-muted`/`hover:bg-muted/50`. Identical in dark (accent==muted==#2a2827),
  visibly different in light (0.93 vs 0.97). Standardize on accent pair.
- PR-state language disagrees: row icon (`DashboardSidebarWorkspaceIcon.tsx:37-51`,
  merged=purple-500, closed=LuGitPullRequestClosed, size-3.5) vs hover-card badge
  (`PullRequestStatusBadge.tsx:6-12`, merged=violet-500, tints /15) vs dead
  StatusBadge (/10 tints, h-3 w-3). One shared PR_STATE map.
- Diff-stat asymmetry: `text-emerald-500/90` adds vs `text-red-400/90` dels
  (`DashboardSidebarWorkspaceDiffStats.tsx:16,21`) — mismatched shade steps.

Minor (each with exact fix in place):
- TopBar: offline pill `rounded`→`rounded-md bg-muted/60` (:82); gap rhythm 3 values
  (:55,:63,:77); maximize glyph h-3 vs siblings h-3.5 (`WindowControls.tsx:37`);
  corner dead zone `pr-1` breaks Fitts corner-flush close (:22); `h-8 w-8`→`size-8`.
- Header: New Workspace row `gap-1.5` vs siblings `gap-2` (`DashboardSidebarHeader.tsx:362`);
  help menu `h-4 w-4`→`size-4`.
- Project row: hover icon swap instant vs section header 150ms crossfade
  (`DashboardSidebarProjectRow.tsx:77-84` vs `DashboardSidebarSectionHeader.tsx:67-75`);
  plus button `rounded`+`ring-2` vs standard `rounded-md`+`ring-1` (:112).
- Section spine: 2px left border falls back to border color on headers but rows only
  render it when group.color set → spine stops dead (`SortableSectionHeader.tsx:75-78`
  vs `SortableWorkspaceItem.tsx:41`); fallback should be transparent.
- Drag ghosts: section ghost text-[11px]/pl-0.5/(N) vs real text-[13px]/pl-5/N
  (`SidebarDragOverlay.tsx:41-48`); ghosts on `bg-background` while rail is `bg-muted/45`.
- Workspace row: name `text-foreground/80` sole opacity-dimmed text in rail (:250);
  icon `mr-2.5` vs 8px standard (:167,:181 — if changed, also `pl-[50px]/[58px]` →
  `pl-[48px]/[56px]` in `DashboardSidebarWorkspaceDetails.tsx:84`); PR icon hover
  `hover:bg-foreground/10` one-off (:167); minus/X hover buttons no bg affordance
  (:297,:325); collapsed active stripe missing `rounded-r` (`DashboardSidebarWorkspaceItem.tsx:127-133`).
- Chips: agent chip `rounded-full bg-muted text-[11px]` vs port-count `rounded-full
  bg-muted/60 text-[9px]` vs port badge `rounded bg-muted/60 text-[11px]` vs host pill
  `rounded bg-muted px-1 text-[9px]` — four recipes side by side.
- Ellipsis split: `LuEllipsisVertical size-3` (port badge) vs `LuEllipsis size-3.5`
  (section header).
- Ports: `hover:text-primary` one-offs (`DashboardSidebarWorkspaceDetailsAction.tsx:38`,
  `DashboardSidebarPortGroup.tsx:53`); `hover:text-sidebar-foreground` sole use (:37);
  two eyebrow-label styles (ports 11px/wider/70 vs hover-card 10px/wide/full).
- Hover card: tint opacities mixed /10 vs /15 in one card.
- Delete dialog: yellow-* palette where rail warning color is amber-500
  (`DestroyConfirmPane.tsx:74`); log pre bare `rounded border` (`TeardownFailedPane.tsx:58`).
- Menu color-dot styles differ (`SectionActionsMenuItems.tsx:97,103` vs
  `DashboardSidebarWorkspaceContextMenu.tsx:164`).
Clean: zero hardcoded hex in the whole rail; TopBar/sidebar bg seam matches exactly;
close-button destructive hover is the correct token use.

---

## C. Workspace shell + center panes

Major:
- Pane-header buttons: four recipes in one row — split/close `rounded p-0.5` @60%
  (`PaneHeaderActions.tsx:33`); Terminal/Diff extras square `size-5` @100% with
  UN-rounded `bg-secondary` active (`TerminalPaneHeaderExtras.tsx:30-35`,
  `DiffPaneHeaderExtras.tsx:20-25`); Comment/File extras `rounded p-1`
  (`CommentPaneHeaderExtras.tsx:56,72`, `FilePaneHeaderExtras.tsx:66,85`); Browser nav
  `rounded p-1` vs its own devtools/overflow `p-0.5` (`BrowserToolbar.tsx:118,133,147`
  vs `BrowserPane.tsx:133`, `BrowserOverflowMenu.tsx:76`). Three hit sizes (18/20/22px),
  two resting opacities. One recipe: `flex size-5 items-center justify-center rounded
  text-muted-foreground/60 transition-colors hover:text-foreground` + active
  `bg-secondary text-foreground rounded`.
- Focused-pane ring hardcoded `ring-orange-500` (`packages/panes/src/react/components/
  Workspace/components/Tab/components/Pane/Pane.tsx:315`) — clashes with ember
  `--highlight` #e07850, unthemable → `ring-highlight`.
- Divider zoo: Browser toolbar `bg-muted-foreground/60` (2× darker) vs Terminal/Diff
  `bg-muted-foreground/30` vs preset bar `bg-border/60` → one value.
- Run button emerald (see A4); split resize handle `w-px` + 4px hit area + zero hover
  (`packages/ui/src/components/ui/resizable.tsx:42` via `Tab.tsx:97`) vs sidebar handle
  20px + hover highlight (`ResizablePanel.tsx:144-152`) — the most-dragged handle is
  the hardest to grab.

Minor:
- Maximize icon raw SVG 13px vs lucide size-3.5 (`Pane.tsx:265-266,282-283`); its
  position flips per pane type (`PaneHeader.tsx:77-85` vs `DefaultHeaderContent.tsx:46-48`).
- Active-tab `bg-border/30` vs active-header `bg-muted` stacked (`TabItem.tsx:121` /
  `PaneHeader.tsx:63`).
- Extras→actions divider only on Terminal/Diff, missing on Comment/File.
- File pane icon `size-4` vs everyone `size-3.5` (`usePaneRegistry.tsx:262`).
- Two inline-rename input styles (`TabItem.tsx:134` vs `TerminalSessionDropdown.tsx:349`).
- Terminal pencil `hover:bg-muted` + size-3 icon third style (:409,:416; chevron :399).
- Chrome border opacities: tab bar full vs preset bar /60 vs Run /50 → `/60`.
- Preset bar: gear hover `bg-accent` vs chips `bg-muted/60` (`V2PresetsBar.tsx:213-218`
  vs `V2PresetBarItem.tsx:95`).
- Run button icons size-3 vs 3.5 (:89,:112); disabled opacity-50 vs browser 30.
- Sticky prompt "more" chip `text-[10px]` (`TerminalStickyPrompt.tsx:121`).
- Browser overlays: blank centered `text-sm` vs error left-aligned `text-xl`
  (`BrowserPane.tsx:61-73` vs `BrowserErrorOverlay.tsx:68-87`); details box
  `border-muted-foreground/20` sole non-border-token border (:90).
- Diff: per-file buttons `hover:bg-accent` unlike header buttons
  (`DiffHeaderMetadata.tsx:101,116,152`, `DiffHeaderPrefix.tsx:30`); viewed checkbox
  `size-3 border-muted-foreground/50` (:135); composer `shadow-[0_4px_16px...]`
  invisible in dark + micro-type + `rounded-[3px]/[4px]` cluster
  (`AgentCommentComposer.tsx:92,110-189`, `AgentPlacementToggle.tsx:26,35`).
- CommentPane: `text-2xs` is a DEAD utility (defined nowhere) — Copy button renders
  ~16px inherited (`CommentPane.tsx:87`) → `text-[10px]` or define `--text-2xs`.
- Empty states: Superset wordmark (see A7); `WorkspaceMissingWorktreeState.tsx:39-68`
  private type scale text-[15px]/[13px]/[11px] + h-7 text-[13px] buttons vs standard;
  unknown-pane fallback text-xs vs siblings text-sm (`Pane.tsx:340`).
Clean/confirmed: header FRAME is consistent — every pane in the same h-7 PaneHeader,
px-3 gap-2 text-xs, matching title typography; AddTab + BackgroundTerminals share a
recipe; drop-zone overlay + drag insert line both correctly use primary tokens.

---

## D. Right sidebar

Major:
- `bg-[#1b1817]` ×3 (see A2). `dark:` OS-coupling (see A1) hits PRHeader/Checks/Comments.
- Diff stats 3 ways (see A4).
- Two file trees, different metrics: Files 28px rows/10px indent
  (`FilesTab/constants.ts:2-4`) vs Changes tree 24px/8px (`ChangesTreeView.tsx:46-55`)
  — density jumps on tab switch.
- Sub-header heights: Files `h-7` vs Changes branch row ~32px (`ChangesHeader.tsx:46`)
  vs Browser `h-9` (`BrowserTab.tsx:153`), plus left-inset drift px-2/px-3/px-1.5.
- "Reveal in Finder" (see A7).

Minor:
- Strip: `text-[11.5px]` off-scale (SidebarHeader.tsx:43 + BrowserTab.tsx:220);
  lucide + react-icons mixed in one control (`WorkspaceSidebar.tsx:5,7`); tooltip
  arrow inconsistency (:71 vs :75); radius concentricity nit (outer lg + p-[3px]
  should be ~11px).
- Files: "Explorer" header idiom (h-7 11px semibold uppercase wider) vs Changes
  sentence-case text-xs medium (`FilesTab.tsx:291` vs `ChangesSection.tsx:128-135`);
  header buttons size-5/icon-3 vs strip size-6/icon-3.5; three loading idioms
  (Loader2 / Spinner / bare text).
- Pierre tree status tints fixed oklch in both themes
  (`createPierreTreeStyle.ts:67-71`) — derive from the status-token source (A4).
- Changes: folder headers no collapse chevron (`FolderHeader.tsx:32`); children not
  indented vs their header (both pl-3); count badges text-[10px] plain vs text-[11px]
  tabular; icon sizes 3 vs 3.5 in same-size buttons; "No changes" top-aligned vs
  centered siblings; rows snap (no transition-colors) while review rows fade; RTL
  truncation can flip leading dots (`FolderHeader.tsx:35` → wrap in bdi); template-string
  className in `RangeModal.tsx:92-96`.
- Review-in-Changes: double scroll container (`WorkspaceSidebar.tsx:160` +
  `ReviewTabContent.tsx:59`); no section identity label (reads bolted-on); review
  sections py-1.5 + Vsc chevron vs changes py-1 + lucide chevron; hover-action overlay
  backdrop present in CommentRow (:524) missing in FileRow (:148); menu w-64 vs w-56.
- Browser: control heights 26px inputs vs 24px buttons in one row; white flash —
  webview host `bg-white` + overlay hides on isLoading (:288,:290) → `bg-background`
  host or hold overlay until first paint.
- PathActions duplicated component (fold into PathActionsMenuItems); folders-view
  hover menu omits path actions + Discard that tree-view has.
Clean: segmented control mechanics (flex-1, p-[3px], active bg-card+shadow-sm,
compact-mode hysteresis); BaseBranchSelector/CommitFilterDropdown/RangeModal
tokenized; FilesTabDropOverlay fully tokenized.

---

## E. Chat pane

Major:
- 72px rhythm break after every user prompt: always-in-flow invisible hover-actions
  row (`UserMessage.tsx:141-150` + `UserMessageActions.tsx:30-31`) + wrapper pb-1 +
  list gap-6 ⇒ ~72px inside a turn vs 24px between turns → pull bar into the gap
  (`-mb-9` or absolute).
- No assistant actions: user messages get Copy/Edit/Resend, assistant replies (the
  most-copied content) get nothing (`AssistantMessage.tsx:337-349`) → hover Copy
  with the same size-7/size-3.5 recipe.
- User bubble forks the system: hand-rolled `bg-muted px-4 py-2.5`
  (`UserMessageText.tsx:50`) vs canonical `bg-secondary px-4 py-3`
  (`packages/ui/.../message.tsx:60`) — identical only while themes alias muted==secondary.
- Orphaned message components + OS-coupled dark: (see A6, A1).

Minor:
- Sticky wrapper `pb-1` uncompensated (+4px) (`ChatMessageList.tsx:196`); `py-6`
  should be explicit `px-4 py-6` (:176); streaming tool blocks space-y-3 vs settled
  gap-2 (`ToolPreviewMessage.tsx:36,41`).
- Duplicated Thinking markup (`ThinkingMessage.tsx:6-12` vs `AssistantMessage.tsx:340-344`).
- Status-tag shapes: InterruptedFooter `rounded uppercase` vs subagent `rounded-full`.
- Image max-w-[85%] on assistant triggers only; modern user path unconstrained
  (`UserMessageAttachments.tsx:64-71`).
- Edit-mode silhouette jump: editor `rounded-xl bg-muted/45` vs bubble `rounded-lg
  bg-muted`; single-line input for multiline messages (`UserMessageEditor.tsx:84`).
- om_* row bare text vs shimmer/card treatment (`AssistantMessage.tsx:309-318`).
- Approval cards: `justify-between` vs `justify-end` action rows; selected Approve
  DEMOTES from solid to translucent at confirmation (`PendingApprovalMessage.tsx:52-56,87`,
  `PendingPlanApprovalMessage.tsx:138,156-160`) → keep solid + spinner.
- Composer: left gap-1.5 vs right gap-2 (`ChatComposerControls.tsx:55,73`); send
  circle breaks pill family + three fill levels (0.02/0.04/0.10); send never signals
  readiness → `bg-primary text-primary-foreground` when submittable (:76-87);
  `border-[0.5px]` may vanish at 100% scaling on 1× displays (`STYLES:6`,
  `ChatInputFooter.tsx:187`); empty spacer div (:235); focus hint can overlap typed
  text (:182); FileDropOverlay bare rectangle → dashed rounded (`FileDropOverlay.tsx:11`);
  SlashCommandPreview panel + labels drift from card recipe (:176,:209);
  param fields text-[11px]/[10px] → text-xs.
- Model picker: Claude logo raw <img> bypasses ModelSelectorLogo (`ModelPicker.tsx:66-68`,
  `ModelProviderGroup.tsx:102-104`); trigger chevron lucide size-2.5 vs pane chevron
  react-icons size-3 (:72 vs `SessionSelector.tsx:121`).
- Chips: AttachmentChip `border-foreground/20` invented border + inverted radius
  nesting + size-3 icons (:20,:24,:28-30); SessionSelector trash inherits foreground,
  ~16px hit target (`SessionSelectorItem.tsx:36`).
- ChatSearch: `hover:bg-muted-foreground/20` foreground-as-bg (unique) (:88-128);
  bare `rounded` container (:59); text-sm input beside text-xs controls (:68); two
  frosted-overlay recipes vs MessageScrollbackRail (:289); rail opacity ladder /12
  nonstandard + transition-all on 2px bar (:258-271).
- Empty-state icon filled hi2 on a stroked-lucide surface (`ChatMessageList.tsx:10,184`).
Clean: rhythm architecture is sound (single gap-6, shared Message wrapper, NO
per-type margin fights); the four system cards share an exact recipe — best-in-pane;
both columns center at max-w-[680px] precisely.

---

## F. The standard set (apply everywhere → one product)

- **Tokens:** add `--success/-foreground`, `--warning`, `--info`; retire 370 palette
  classes. `destructive-foreground` never standalone.
- **Radius (from --radius=10px):** `rounded-md` controls / `rounded-lg` floating +
  modal surfaces / `rounded-xl` cards + hero inputs. Ban bare `rounded` (156 uses,
  fixed 4px, not token-derived) and `rounded-[Npx]` stragglers (13px×7, 3px×5, 2px×4,
  4px×2, 6px×1).
- **Header heights:** `h-12` window chrome / `h-11` panel + sidebar headers / `h-8`
  sub-toolbars. (Current: h-8/h-10/h-11/h-12/none across surfaces.)
- **Secondary text:** `text-muted-foreground` + `/70` for tertiary ONLY (currently 9
  opacity steps ×216 uses + 33 `text-foreground/NN`). Kill `text-[12px]`≡`text-xs`
  (23) and `text-[14px]`≡`text-sm` (2) and `text-[11.5px]` (2); bless exactly 10px +
  11px as named micro sizes (155 + 97 uses).
- **Icons:** `size-4` default / `size-3.5` dense; migrate 134 legacy `h-N w-N`;
  strokeWidth 1.5 or 2 via shared constant (currently 7 values). One icon library
  per surface (lucide) — hi2/pi/Vsc/Lu mixing in chat + sidebar chrome.
- **Gaps:** `gap-1.5` icon+label in-control / `gap-2` between controls; `px-2` list
  rows / `px-3` toolbars.
- **Shadows:** `shadow-md` popovers/menus/search overlays / `shadow-lg` modals
  (fix dropdown SubContent shadow-lg vs Content shadow-md).
- **Dialogs:** 4 width presets (confirm 340 / form 420-480 / wide 640 / full 900)
  replacing 14+ distinct max-widths across 55 usages; add a real unpadded variant
  instead of 17+ `gap-0 p-0` opt-outs; converge destructive confirms; cancel = ghost.
- **Spinners:** one component (currently Spinner / Loader2 / LuLoaderCircle /
  LuLoader + 75 raw animate-spin).
- **Buttons:** toolbars → `Button variant="ghost" size="icon-*"`; shared focus-ring.
- Note: `packages/ui/src/globals.css` is a divergent second theme file (neutral
  shadcn palette, no --tertiary/--highlight) — a booby trap for standalone builds.

---

## G. Suggested phasing

**1.15.8 (bugs + highest-visibility, low-risk):** A1 dark-variant one-liner; A2
`#1b1817`→tertiary (3); A3 destructive-foreground→destructive (5); pane focus ring
→ highlight; success/warning tokens + Run button + diff-stat unification; pane-header
button recipe + divider normalization; chat 72px gap + assistant Copy; Reveal in
Finder → File Explorer; dead-code deletion (A6); dead project separators; browser
white-flash; split-handle affordance.

**Later (1.15.9+ sweeps):** radius/height/text/icon/gap standardization; raw-button
→ Button + focus rings; dialog presets; branding sweep (Superset→GatedSpace copy,
wordmark, boot glow, docs links); spinner unification; v1/v2 dedupe strategy;
scrollbar theming.
