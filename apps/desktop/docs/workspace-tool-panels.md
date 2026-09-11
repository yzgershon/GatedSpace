# Workspace tool panels

The main pane grid and floating top-bar groups remain the primary workspace.
The upper-right visible pane owns the single pair of right/bottom tool buttons;
maximizing a pane transfers those controls to that pane. Session headers put the
Explorer folder button first, followed by the session name, quick new-pane button
and shared overflow menu. The running account and rename action live in that menu.
Right-click and overflow menus use the same action definitions.

`WorkspaceToolPanels` provides two resizable, animated panels with sortable tabs.
Files, Changes, Browser, Terminal and Side session can be opened from either
panel. Files opens editors in a tool tab. Existing file-tree, Git/review, editor,
browser and terminal implementations supply the contents and their existing
actions. Tab strips support pointer and keyboard dragging, closing and moving
the selected tab to the other panel. Hiding a panel parks its contents after
the closing transition; it does not close sessions. Reduced-motion preferences
disable animations. Opening an empty right panel shows a chooser for Files,
Side session, Browser, Terminal and Changes, without creating a browser or shell.
Reopening a populated panel restores its selected tool; closing its last tab
returns to the chooser. The bottom panel still starts a terminal on first open.
The outer tool gutters use the same pane-well background as the main grid, so
the rounded cards do not sit on differently colored rectangular patches.

The tool layout has one pane store and one lifecycle owner, independent of the
main pane store. Moving tabs between panels only changes placement/order; a
pane never disappears from its store during that move. The page keys the tool
shell by host/workspace so switching workspaces does not infer that tools were
closed. An active-group context prevents simultaneous main/right/bottom terminal
hotkeys. Browser guests forward focus through their placeholders and clip their
native overlays to the animated workspace region.

Tool state uses a new renderer storage namespace:
`gatedspace:workspace-tools:v1:<host>:<workspaceId>`. It stores pane/tab identity,
order, selection, panel visibility and sizes. Writes are debounced and flushed
on workspace unmount/pagehide. Persisted layouts are validated on read. None of
the retired `rightSidebarEnabled`, `rightSidebarOpen`, `rightSidebarWidth` or
fixed Changes/Files/Browser selection fields controls these panels. Those old
schema fields remain readable for compatibility only. The retired sidebar
container, fixed header, detached Browser tab, top-level toggle, dashboard slot
and appearance enable switch have been removed. Existing command/shortcut
entry points now target the shared right tools panel.

## Verification

- `bun test packages/panes/src` from the repository root.
- `bun test 'src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store.test.ts'` from `apps/desktop`.
- `bun run scripts/test-workspace-tools.ts` from `apps/desktop` runs the real
  header/panel components in an isolated offscreen Electron window, with actual
  xterm/WebGL and browser runtime instances. IPC/account data and session bodies
  are fixtures; it does not launch the installed app, real agents or an installer.
  It exercises drag events, focus, transitions, tab moves, unsaved-close guards,
  compact dimensions and terminal viewport geometry at 85% scale. Output is in
  `.tmp/workspace-tools-test/`.
  After production compilation, add `--production-css` to verify against the
  compiled renderer's styles. The suite also checks the chooser's lifecycle and
  compares rendered pixels in the main, right and bottom gutters.
- `bun run scripts/test-terminal-rendering.ts` retains the separate terminal
  viewport regression suite.
- Desktop/panes type checks, repository lint and `bun run compile:app` validate
  the actual production code. Compilation is separate from versioning and
  packaging a personal installer.
