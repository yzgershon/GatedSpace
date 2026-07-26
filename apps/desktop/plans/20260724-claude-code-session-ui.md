# Claude Code Session UI (VS Code-style) — spec

Target: **1.16** (NOT 1.15.8, which is polish and ships first).

Goal, in Yish's words: keep "this exact setup" — the real Claude Code with every
capability — but render it as a **session chat UI** instead of a terminal. Terminal
panes stay available under the **+** (still the only way to run Codex, git, builds).

Built **from scratch**: new pane, new data model, new chat-specific components.
Reuses only the shared design system (tokens, Button/Tooltip/DropdownMenu) and the
existing markdown / syntax-highlight / mermaid renderers, so it looks native and we
don't re-solve highlighting.

**Explicitly NOT built on the existing Chat pane.** That pane is a `mastracode`
agent hitting the Anthropic API directly: 0 references to CLAUDE.md, 0 skills, 0
subagents, no `/compact`, no resume, and API-key-only auth (its "invalid x-api-key"
error is a Claude *subscription* OAuth token being sent as an `x-api-key`, which
Anthropic will always reject — different auth systems). Its message model is shaped
around that agent, not Claude Code's events.

## Why this preserves every capability

We spawn the **real `claude` binary**, so CLAUDE.md, skills, subagents, MCP, hooks,
output styles, plan mode, slash commands, the Pro subscription, and
`CLAUDE_CONFIG_DIR` account switching all keep working — none of that lives in the
terminal. The terminal was only drawing pixels.

Verified on the installed CLI (**2.1.218**):
- `--print --input-format stream-json --output-format stream-json --verbose`
- `--resume` / `--continue` / `--from-pr` for history
- Live capture committed alongside this doc:
  `20260723-claude-code-session-ui-schema-sample.jsonl`
- **`apiKeySource: "none"`** in that capture = it ran on the subscription, no API key.
- Capture ran under `.claude-robbie` (`memory_paths`), so profile switching works headless.

## Verified event schema (from the real capture)

| Event | Carries | UI use |
|---|---|---|
| `system` / `init` | `session_id`, `cwd`, `tools[]`, `mcp_servers[]` (+status), `model`, `permissionMode`, `slash_commands[]`, `agents[]`, `skills[]`, `output_style`, `capabilities[]`, `memory_paths` | session header; **native slash-command autocomplete from real data**; MCP/model/permission indicators |
| `system` / `hook_started` \| `hook_response` | `hook_name`, `hook_event`, `exit_code`, `outcome`, stdout/stderr | quiet hook activity row (collapsed by default) |
| `assistant` | `message.content[]` (text / tool_use), `usage`, `model`, **`parent_tool_use_id`**, `uuid`, `timestamp` | message stream; `parent_tool_use_id` → **nest subagent work in collapsible groups** |
| `user` | tool_result blocks | tool output, folded into its tool card |
| `rate_limit_event` | `status`, `resetsAt`, `rateLimitType` (e.g. five_hour), overage flags | **usage indicator** — closes the statusline gap |
| `result` | `total_cost_usd`, `usage`, `modelUsage`, `num_turns`, `duration_ms`, `permission_denials[]`, `terminal_reason`, `result` | **end-of-turn rundown** (the "full rundown at the end" feel) |

`capabilities: ["interrupt_receipt_v1", "msg_lifecycle_v1"]` → **interrupt is a
first-class protocol feature**, so Stop is clean rather than a SIGINT hack.

## The core design idea

What Yish likes about VS Code is *not* that Claude says less — it's that a GUI can
**collapse tool activity**. A TTY must linearize every step into permanent scrollback;
a GUI shows a compact row per tool call and keeps the prose clean, with the rundown
at the end. So: collapse aggressively by default, expand on demand.

- Tool calls → one compact row each (icon + title + status), expandable for input/output
- Consecutive tool calls → grouped
- Subagent work (`parent_tool_use_id`) → single collapsed group ("Explore · 5 steps")
- Thinking → collapsed by default
- Hooks → very quiet
- Prose → full width, uncollapsed, primary

## Build order

1. **Transport** — spawn `claude` with the stream-json flags; NDJSON framing; lifecycle
   (start/stop/interrupt/resume); pass `CLAUDE_CONFIG_DIR` for the active profile.
2. **Typed event model** — discriminated union matching the table above; parse to a
   normalized session timeline. No `any`.
3. **Renderer** — message list + collapsible tool/subagent cards + prose.
4. **Composer** — input, slash-command autocomplete from `init.slash_commands`,
   @file mentions, attachments, Stop button.
5. **Approvals** — permission requests → approval UI (approve / always / reject).
6. **Session header + usage** — model, permission mode, MCP status, rate-limit chip.
7. **Resume** — session list via `--resume`.

## CORRECTION to the "collapse aggressively" idea above

Wrong. Yish's screenshots show tool calls **expanded by default**. What makes it read
calm is that everything is **bounded and structured**, not hidden:

- every block sits on a **left gutter dot**: green = done, dim = thinking/prose,
  orange `*` = in progress
- tool name **bold**, argument monospace on the SAME line (`Read C:\...\GatedVoice.csproj`
  is one line, not a card)
- output blocks have a max height and **fade out** at the bottom instead of dumping
- `Thinking` live → `Thought for 1s` when done (one line)
- no spinner spam, no repeated status lines, no ANSI redraw noise

## Decisions (confirmed by Yish 2026-07-24)

| # | Decision |
|---|---|
| Pane model | **Unchanged from today** — same tab/pane behaviour GatedSpace already has |
| Session list | Lives in the **left sidebar** |
| User message | **VS Code style**: full-width bordered box, left-aligned. NOT a right-side bubble |
| Gutter dots | **Yes** (green / dim / orange-asterisk) |
| Thinking | **Expandable** to read reasoning |
| Tool calls | **Expanded by default**, bounded output + fade, **click to expand full** |
| Per-tool rendering | **Copy VS Code exactly for now** (one-liners for Read/Glob, IN/OUT for Bash/PowerShell, path + "Added N lines" + diff for Edit) |
| Subagents | **Collapsible groups** |
| Mic | **Dropped** — GatedVoice handles dictation |
| Queue while running | **Yes** |
| Rewind | **Yes** |
| Modes | **Manual / Edit automatically / Plan / Auto** (VS Code's friendly names) |
| Effort | **Yes, 5-dot slider.** At **max** the max dot goes **rainbow**; under **ultracode** the whole slider gets an **animated purple glow** |
| Usage | **Keep GatedSpace's own usage feature**, NOT VS Code's modal — because Yish runs multiple Claude accounts and wants them in one place |
| Web sessions | **Skipped** (local only) |
| Session scope | **Per workspace / project** |
| Providers | Claude first |
| Version | **1.16**, after 1.15.8 |

## Left sidebar restructure (new requirement)

VS Code-style **icon rail** (activity bar) with clickable icons that expand a panel.
**Only three icons:**

1. **Recent sessions** — the session list
2. **Usage** — GatedSpace's multi-account usage surface
3. **Workspaces** — expands to the screen Yish uses today (all active sessions).
   The existing **New Workspace → local / worktree** flow is **unchanged**; it's just
   now nested under the Workspaces icon and expands when clicked.

So this is an app-shell change, not only a new pane. The current DashboardSidebar
content becomes the Workspaces panel.

## Round 2 decisions (2026-07-24)

- **Session = a pane/tab exactly like a terminal** — splittable beside terminals.
- **Diff: side-by-side**, definitively.
- **Effort slider has SIX positions**: `low · medium · high · xhigh · max · ultracode`.
  `ultracode` = **xhigh effort + workflows**. Set via `/effort` OR by dragging to that
  position. Visuals: **max → rainbow on the max dot**; **ultracode → animated purple
  glow across the whole slider**.
- **Recent sessions: across ALL workspaces AND all Claude accounts**, plus a
  **Codex toggle/slider** in the same panel.
- **Usage: all accounts in one view** (this is the whole reason we keep ours).

### Left sidebar, precisely

Not "icons replace the sidebar" — it's an **icon rail on the leftmost edge**, a
**divider line**, then the **panel contents** to its right (exactly VS Code's activity
bar + side bar). Three rail entries:

1. **Recent sessions** → all sessions, all workspaces, all Claude accounts (+ Codex toggle)
2. **Usage** → all accounts in one view
3. **Workspaces** → today's content unchanged (workspace / local / worktree)

The session itself fills the rest of the screen.

### Shell changes beyond the rail

- **Keep the agents toolbar at the top** (Claude · Codex · Gemini · …) so a pane is
  one click away.
- **Remove the Automations tab and the Tasks & PRs tab** from the sidebar. Both move
  into a **small popup opened by clicking the profile ("Yishai") in the top left**.
- **Profile stays top-left. Settings stays at the bottom.**
- **Settings gets a visual overhaul** ("make all the settings look better").

## Round 3 — final decisions (2026-07-24). Spec is CLOSED; build may start.

- **Phasing approved:**
  - **1.16** = the session pane itself (transport, renderer, composer, modes, effort,
    approvals, subagent groups, queue, rewind).
  - **1.17** = shell restructure (icon rail, profile popup, Automations + Tasks & PRs
    moves, settings restructure).
- **Codex in Recent sessions: LIST ONLY.** Codex has no `stream-json` equivalent, so
  Codex sessions are listed and **open in a terminal pane**. No second renderer.
- **Agents toolbar:** clicking **Claude** now opens a **session pane (new UI)** instead
  of a terminal. **Codex, Gemini and the rest still open terminals.**
- **Cross-account sessions: auto-switch.** Opening a session belonging to another
  account switches the active account, matching today's behaviour (switch account →
  open an agent → that agent is bound to the switched account).
- **Usage: local `.jsonl` reads ONLY, never live polling.** This is a hard rule from the
  2026-07-13 quota-burn incident; the all-accounts view must not regress it.
- **Settings: RESTRUCTURE** (not just a visual pass) — information architecture is in
  scope for 1.17.
- `ultracode` note: Yish was describing VS Code's own labelling — VS Code shows the
  animated purple glow for it. Selecting it still changes behaviour (xhigh + workflows,
  i.e. parallel agent fleets), so the glow doubles as the "this burns usage" signal.

## Still open

- Q1 rephrase: where the session surface lives (Yish: "don't understand the question")
- Q11 rephrase: side-by-side vs unified diff (Yish: "i dont know what diff is")
- Is **ultracode** a 6th slider position, or a separate state that lights the slider?
- Do **Recent sessions** span all workspaces, or only the active one?
- Does the Usage panel show all three accounts (Yish / Amitai / Robbie) at once?
- Output fade cutoff: derive exact line count from the screenshots (looks ~8-10 lines);
  make it one tunable constant.

---

## Build log — 7/24 (session persistence, streaming, effort)

### Tab-reset bug (fixed, `45a002c04`)

Leaving a workspace tab and coming back showed a blank session. The pane
unmounts on every tab switch and the timeline lived in React `useState`, so the
UI threw its copy away while the `claude` process kept running in main.

Two layers now hold the conversation:

1. **Main replay buffer.** `session-manager` records every timeline-bearing
   event per session key; the `claudeSession.stream` subscription replays that
   buffer synchronously before attaching the live handler, so no event can slip
   through the gap between replay and attach. Survives a full window reload.
   `stream_event` deltas and status/hook pings are forwarded live but never
   stored — buffering them would balloon a long session into tens of thousands
   of objects for no gain, since they don't change the fold.
2. **Renderer session store** (`sessionStore.ts`). A module singleton keyed by
   pane id holding the folded timeline plus the subscription, outside the React
   tree. The pane binds through `useSyncExternalStore`. A tab switch re-attaches
   instantly with no refold, and UI-only state (mode, effort) has a home main
   doesn't need to know about.

**New synthetic event: `local_user_message`.** The CLI never echoes user
prompts back (that needs `--replay-user-messages`), so main records its own
event when it writes to stdin. Without it the replay buffer would hold only
Claude's half of the conversation. This replaced the renderer's optimistic
user-message path — there's no local copy to reconcile any more.

**Pane close now kills the process** via `onAfterClose` → `disposeSession`.
Sessions deliberately outlive an unmount; closing the pane is the one thing
that ends them.

### Live token streaming (`22c7e6840`)

Text and thinking used to appear in one jump when a block settled.
`content_block_start` now opens a **draft** item, the SSE deltas type into it,
and the coalesced `assistant` event replaces that draft **in place** rather than
appending a duplicate.

- Drafts live in `timeline.drafts`, keyed `${parentToolUseId ?? "main"}:${index}`
  — deltas only carry a block index, and a subagent streams its own indices in
  parallel with the main agent.
- Verified ordering: the per-block `assistant` event arrives *before* that
  block's `content_block_stop`, and every block of a turn shares one
  `message.id`.
- Tool `input_json_delta` is ignored on purpose — a half-parsed JSON argument
  reads as broken; the card fills its arguments in a moment later.
- **Tested invariant:** folding the full stream and folding only the events main
  buffers produce *identical* timelines. What you watch being typed is exactly
  what you get back after a remount.
- Blinking caret on live text; the collapsed "Thinking" label pulses so a long
  think doesn't read as stuck.
- Stick-to-bottom scrolling, but only while you're already at the bottom —
  scroll up to read something and it leaves you alone.

### Effort is real now, not cosmetic

Probed against the installed CLI: the command is
`/effort <low|medium|high|xhigh|max|auto>`, it works over stream-json stdin, and
it answers instantly (local command, no API turn). **`ultracode` is a recognized
token** — it failed with "Ultracode runs at xhigh effort, which <model> doesn't
support", i.e. valid input that needs an xhigh-capable model. So the 6-dot
slider maps 1:1 onto real CLI values.

Moving the slider sends `/effort <level>` as a **silent** control message (new
`silent` flag on the send mutation suppresses the user-message echo; the CLI's
one-line confirmation still renders, which is the feedback you want). A level
picked before the session is up is held in `pendingEffort` and flushed on init.

### Answered from the "still open" list

- **Mode change mid-session has no slash command.** The full command list from a
  real `system/init` has no `/permissions` or `/mode`. Changing mode therefore
  means restarting the process — worth doing with `--resume <session_id>` so the
  conversation survives, which is the same plumbing the resume feature needs.

### Mode change (`6f8d12dc6`)

The mode dropdown only ever applied at spawn time. Since there's no slash
command for it, changing it respawns the process with `--resume <session_id>`.

Probed before building, because a resume that replayed history would have
duplicated the entire timeline: **it doesn't.** A resumed run emits `init` and
goes straight to the new turn, keeps the same `session_id`, and genuinely
remembers the earlier conversation.

Hardening that fell out of this: a replaced transport can still flush output on
its way out, so every manager handler now checks it's the *current* transport
for that key. A dying process can't emit into — or deregister — its successor.

### History from disk (`ab9af2b62`)

Main's replay buffer dies with the process, so a restored workspace layout
reopened a session pane as a blank chat even though the conversation was still
on disk. Panes now persist their session id into pane data, and a resumed pane
paints its stored transcript before attaching to the live stream.

- **No second parser.** The stored JSONL's `assistant`/`user` entries carry the
  same Anthropic message shape as the live protocol, so the shared reducer folds
  them as-is. Everything else in the file (`ai-title`, `mode`,
  `file-history-snapshot`, `attachment`, `system/thinking_tokens`, …) is a type
  the reducer already ignores.
- **What the reducer did need:** rendering a real user prompt. Live `user`
  events only ever carry `tool_result` blocks; a transcript puts the actual
  prompt there, often as a bare string.
- Bounded tail read (1.5 MB), CLI bookkeeping entries dropped (continuation
  caveats, slash-command wrappers, `isMeta`), `parent_tool_use_id` normalised
  (transcripts leave it undefined where the live stream sends null), and the
  result `settled()` — transcripts carry no `result` event, so a raw fold would
  render loaded history as a turn still in flight.
- Checked against a real 338-event transcript: 203 items, 135/136 tool cards
  paired with output (the odd one still running), no scaffolding lines, first
  prompt exactly as typed.

---

## Build log — second wave (same day)

### Correction: approvals aren't buildable here

Earlier notes said interactive approval "just needs the `--permission-prompt-tool`
MCP integration". **That flag does not exist in this CLI.** The only permission
surfaces `claude --help` offers are `--permission-mode`, `--allowedTools`,
`--disallowedTools` and `--tools`. There is no interactive approval hook to
wire up, so click-to-approve is off the table until the CLI grows one. The
nearest real feature is allow/deny tool lists in the composer.

### The two-writer guard had a hole, and it was ours

Found by a GatedSpace session reviewing the commit that claimed the guard was
safe. Ownership was recorded when a session's `init` event arrived — a second
or two after spawn — so two panes resuming the same id inside that window both
passed the check. Separately, the map was never cleared when a key started
fresh, so a dead session's id went on blocking legitimate resumes.

Ownership is now claimed at spawn, on intent (`resume-claim.ts`, a pure
function with tests); `init` only confirms it. The manager spawns real
processes, which is exactly why this logic had no coverage and shipped wrong —
the fix was to pull the decision out where it could be tested.

### Everything else

- **Fork** (`--fork-session`): a blocked resume forks instead of starting fresh,
  so the conversation survives into a separate transcript. No terminal fallback
  left for Claude sessions.
- **No more `shell: true`.** Defensible while every argument came from this
  codebase; not once preset args reached argv, since a shell interprets `&&`
  inside an argument. PATH is resolved here, preferring a real `claude.exe`.
- **Failures are visible.** stderr, exit and error were all emitted and none
  consumed — a failed spawn left the pane spinning. Now a fatal notice with the
  stderr tail, and a Restart that resumes the session id.
- **Context and rate limits** were arriving on every result event and being
  discarded. Both now show in the header; context warns amber past 70%, red
  past 90%.
- **@mention autocomplete** over `filesystem.searchFiles`. The CLI already read
  `@paths` out of prompt text — this only adds the picker.
- **Tabs are titled** by the opening prompt instead of all reading "Claude", and
  tool cards prefer `description`, so a Task says what it's doing.

### 1.17, started

Automations and Tasks & PRs moved out of the sidebar rail into the profile
menu, and settings regrouped by what's being configured (App / Coding /
Account / Organization / System) — Account had been split from Billing and API
Keys across two groups.

**Not done, deliberately:** the agents toolbar still opens terminals. It runs
*presets*, which are multi-command recipes with execution modes and a cwd
override, not a "Claude button" to flip. And Recent sessions stays out of the
global rail: it's already in the workspace `+` menu where the liveness checks
work, and a rail entry outside workspace context would lose the host's
terminal-binding check.

### Third wave — matched to the VS Code extension

Yish supplied five screenshots of the VS Code Claude Code extension as the visual
spec. The previous layout was defensible on its own terms and wrong against that
reference in six specific ways, all now fixed in `43421469a`:

| Was | Is |
| --- | --- |
| Centered `max-w-3xl` column | Full width — a split diff and an unwrapped shell command both need the room |
| Dots threaded on a vertical rail | Standalone dots; the rail implied nesting that isn't there |
| Prompt as a left quote bar | Prompt as a full-width panel, so a turn boundary is unmistakable |
| Tool call as a bordered card | Tool call as a header line: bold name + the one identifying argument |
| Shell output only | Shell shows **IN** and **OUT**; output without its command is unreadable a screen later |
| Every tool dumped its output | Bodies are earned: edits diff, searches count, `Read` shows nothing |

The composer changed shape too. Mode and effort were two controls answering one
question, so they collapsed into a single popup off the composer, with a
description per mode, a checkmark on the active one, and the effort dots along the
bottom. `Shift+Tab` cycles modes and `Ctrl+Esc` takes the caret, because the popup
and the placeholder respectively claim they do — a hint that isn't true is worse
than no hint. The card now floats over the timeline instead of docking under it,
which is what lets the conversation keep the full pane width.

The diff renders `MultiFileDiff` directly rather than reusing the chat pane's
`EditToolExpandedDiff`: that wrapper reaches for font settings through an
`electronTrpc` **hook**, and hooks against that client have hijacked this tree's
trpc context before. It also reads its view mode from the Changes store, while a
timeline edit always wants split.

**Tested, not just eyeballed.** The five decisions a row makes — which argument
identifies a call, what the old/new pairs of an edit are, the net line delta, the
hit count, the next mode — are pure functions with 26 tests. That's the lesson
from the two-writer bug: the parts that only get exercised by rendering are the
parts that quietly go wrong on a transcript nobody happened to open.

**Deliberate divergences from the screenshots:** no mic (GatedVoice owns
dictation); "Auto" describes what `bypassPermissions` actually does rather than
the extension's "pauses for anything risky", which would be false; six effort dots
rather than five, per Yish's spec; no Account & Usage modal, since the header
chips carry the live signal.

### Slash-command panels — what the probes settled

Yish wants `/usage`, `/model` and `/context` to open panels instead of printing
text, with the menu appearing live as he types rather than on Enter.

Probing first split them into two kinds, which the implementation has to respect:

**Account-level — `/usage`.** Answered by a ONE-SHOT process (`turns=0 cost=0`),
and the answer is the same wherever it runs. That's what let the usage refresh
run per PROFILE and fix accounts that aren't the active one. Built:
`shared/claude-session/usage-report.ts` + `main/lib/claude-session/usage-refresh.ts`.

**Session-level — `/context` and `/model`.** A one-shot answers about a FRESH
session, not the live one: `/context` in a throwaway process reported 23.6k
tokens against a conversation actually sitting at 377k. Running these one-shot
would render a confident wrong number. They have to execute inside the live
session.

That needs a capability the transport doesn't have yet. `silent` currently
suppresses only the ECHO of the user's message; the CLI's reply still lands in
the timeline as assistant text. Capturing it means tagging the request in the
session manager so its reply is diverted from BOTH the replay buffer and the
live stream, and delivered to the caller instead. Worth doing carefully — this
is the component whose two-writer guard shipped wrong once already.

Formats, captured verbatim:
- `/context` → markdown, with an `### Estimated usage by category` table
  (Category | Tokens | Percentage), then `### MCP Tools` and `### Skills` tables.
  Parse the tables; don't render the markdown raw.
- `/model` (no args) → the local command lists the valid ids:
  `sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan,
  default`. This is the probe the model picker was blocked on — the ids no
  longer have to be guessed.

## Sidebar rebuild — stage 2 design (decided, not yet built)

Stage 1 shipped in `9151eea01`: icon rail (Workspaces / Recent sessions / Usage /
Testing), panel beside it, click-active-to-collapse, settings + help pinned
bottom. Recent sessions and Usage sit behind `SidebarPendingPanel`, which keeps
their old behaviour reachable so the rebuild never removes a working button.

**Stage 2 is the real Recent sessions panel.** The UI is the easy half — title,
`+ New session`, Claude/Codex toggle, search, flat list of title + relative time,
hover actions, selected row. `ClaudeSessionsPane.tsx` already has the list, the
filtering and `formatRelativeTime`; extract the presentational part and share it.

**The hard half is the liveness check, and Yish chose option B: expose the host
bindings globally.**

Why it matters: the list decides RESUME vs FORK by asking which sessions are
already live. It has two sources.

  claudeSession.liveSessionIds   main process — works anywhere, incl. the rail
  terminalAgents.list            HOST SERVICE — currently only reachable through
                                 the workspace-scoped `workspaceTrpc` client

Only the second is unavailable from the sidebar, and it is exactly the one that
knows a session a TERMINAL is holding. Resuming such a session in a pane is the
case that silently destroyed a transcript on 7/18 and again on 7/19. Do not ship
the panel without it.

Option A (rejected): let the sidebar delegate the decision into the active
workspace, where the check already works. Less new surface, but keeps the rail
dependent on a workspace being focused.

Option B (chosen): build a standalone tRPC client against the local host so the
rail can ask directly.

What B needs:
  - `useLocalHostService()` exposes `activeHostUrl` but NO client. The React
    client is `createTRPCReact<AppRouter>` in packages/workspace-client/
    workspace-trpc.ts; find where its Provider is configured with a URL and
    reuse those links for a plain `createTRPCClient` keyed by host URL.
  - Handle the states the workspace-scoped client never had to: host down, host
    still starting, and `activeHostUrl === null`. **Unknown must not read as
    "not live"** — if the bindings can't be fetched, treat sessions as
    unverifiable and offer fork rather than a plain resume. Failing safe costs a
    new session id; failing open costs a conversation.
  - Multiple hosts are possible in principle (remote workspaces). All of Yish's
    are local, so query the local host only and leave remote sessions out of the
    list rather than half-supporting them.

Clicking a session still opens it in the workspace you're in — unchanged from
today, and Yish confirmed that's what he wants.
