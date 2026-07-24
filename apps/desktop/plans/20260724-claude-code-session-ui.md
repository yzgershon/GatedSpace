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
