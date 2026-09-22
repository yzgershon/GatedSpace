# Native Codex sessions

Codex opens as a native session pane. The agent menu still offers an explicit
terminal launch. Existing terminal panes are left intact; they are not converted.
Native sessions use the locally installed Codex CLI's `app-server` protocol and
its signed-in account/configuration. No API key or separate SDK billing is needed
for an existing ChatGPT login.

The main-process manager owns the app-server connection and conversation IDs.
Switching tabs only detaches the renderer subscription; closing a pane interrupts
its active turn and unsubscribes the thread. A restored pane resumes its saved
thread ID, and a fork persists its new ID. Duplicate and concurrent ownership is
rejected. Threads reported as active in another client require a fork or waiting
for that turn to finish.

Models and supported effort levels come from `model/list`. History uses
`thread/items/list` with a bounded initial page and a Load earlier control. A
method-not-found or unsupported-method response falls back to legacy thread history; other failures are
shown instead of silently dropping history. Recents uses thread metadata and
excludes archived conversations. Codex removal archives through its API.

The composer supports streaming, interruption, images/text attachments, command
and file approvals, questions, changes, and drafts. Default permissions use
workspace-write with on-request approvals. Full access is an explicit composer
choice. Unknown server requests fail closed. Native sessions currently run on the
local machine; remote workspaces retain the terminal route. Older CLIs without
app-server support show a connection error and must be updated.

Codex uses the Focus composer, model/mode dropdown, and compact effort slider.
Claude uses its earlier VS Code extension-style composer: attachment controls,
the combined mode/effort popup, model tab, and compact variant for the raised-pane
appearance. Both keep measured input growth without moving the caret.
Codex defaults to Extra High when supported. Fast is an explicit per-session
choice: Codex uses the fast service tier; Claude waits for its local `/fast`
acknowledgement. The input grows to ten full lines and a faded continuation before
scrolling. `/` opens supported commands and `$` discovers enabled workspace skills.
Unknown slash commands remain unsent drafts.

New threads use the closest registered folder project, creating that association
when needed. Resumed unassigned threads gain an association without moving already
assigned threads. Older CLIs without project APIs remain usable. This sets project
metadata; it does not change the Codex desktop app's global conversation-view mode.
On Windows, the native CLI executable is launched directly with a hidden console,
avoiding the npm wrapper's visible child terminal.

The sidebar subscription-limit bar follows the focused session's provider and
account. Codex quota comes from `account/rateLimits/read`, independently of historical
spend scans. Cached workspace rows stay visible during collection hydration.

UI colors follow the active GatedSpace theme, including Dracula. Windows terminals
use xterm's DOM renderer to avoid resampling a GPU glyph atlas under fractional
CSS zoom. Their scroll/cursor movement is immediate, while panel opening and
closing animations stay intact. The GPU viewport and shared-atlas fixes remain
enabled on the WebGL rendering path.

## Verification

Both native providers receive a session-scoped `gatedspace_browser` MCP server.
It opens previews in the shared right tool panel and supports HTTP/HTTPS browsing,
DOM snapshots, clicking, text entry, keys, scrolling, screenshots, and console logs.
The local bridge uses short-lived credentials without editing global CLI config.
It is available to fresh and resumed Codex threads and to Claude session processes.
Page content is untrusted; tool availability does not override the selected mode
or the user's authorization. Claude's stdio permission requests appear inline with
Allow once and Decline rather than being silently denied by headless mode.

Browser tools operate on tabs opened by that session. They do not control the OS
or import Codex desktop connectors. Password/file fields and cross-origin iframe
interaction are not supported by this bridge. An inactive workspace must be opened
before its panel can mount; the tool returns an actionable error if it cannot.

Claude resolves the native executable (or the npm JavaScript entry) directly,
avoiding the interactive Windows shell wrapper that corrupted `--settings` JSON.
The saved `claude-acct` / `claude-acct.cmd` preset and its managed absolute path
resolve to native Claude too. The transport already supplies the selected account's
`CLAUDE_CONFIG_DIR`, including pane-specific account pins; the legacy wrapper must
not override it or print its banner into the JSON stream. Custom scripts outside
that managed path are not silently replaced.
Codex publishes a pending user message before awaiting `turn/start`, reconciles
the server echo, and removes a rejected send while keeping its composer draft.
Progress stays in the transcript column directly after the latest activity.
Loading uses the active skin's pane inset, surface and corner radius.

- Unit tests: `bun test src/main/lib/codex-session src/renderer/lib/codex-session`
  from `apps/desktop`, plus shared agent-model/resume and sidebar ownership tests.
- Production UI fixtures: `node scripts/test-codex-session.ts` (Node 24+, installed
  Playwright or `PLAYWRIGHT_MODULE` pointing to its module).
- Hidden Electron terminal: `bun scripts/test-terminal-rendering.ts --dom`, then
  without `--dom` for GPU regressions.
- Shared tools: `bun scripts/test-workspace-tools.ts`.
- Native browser integration: bundle `scripts/check-native-browser.ts` for Node
  with `--external=electron`, then import that bundle from a CommonJS Electron
  bootstrap. It uses hidden windows and isolated user data, real provider MCP
  discovery, Google navigation, page interaction and screenshots. Set
  `GATEDSPACE_LIVE_AGENT_CHECK=1` to additionally run bounded live provider turns
  against its isolated fixture page (`claude` runs just the Claude live turn);
  these consume normal account usage. Claude is tested through the saved account
  wrapper preset, including `--chrome`, rather than only the bare CLI name.

Fixture IPC is deterministic. Real app-server verification is separate: use an
isolated folder, confirm an actual turn and file edit, resume/fork, then archive
the test threads. Do not call fixture results proof of the installed app.

The historical usage dialog still uses approximate legacy API-equivalent prices.
It is explicitly labelled as such and is not a ChatGPT subscription bill. Native
pane context usage comes directly from Codex notifications.
