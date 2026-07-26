# HANDOFF — 1.16 Claude Code session pane

Branch: `windows-port`. Status: **1.16 feature complete AND matched to the VS Code
extension's layout; 1.17 shell work started.**
Typecheck green, 92 unit tests passing, Biome clean.

Personal build `apps/desktop/release/GatedSpace-personal-1.16.0-arm64.exe`
(2026-07-25 00:30, sha256 `aeb86fec…`) contains every commit below. Superseded
builds move to `release/archive/` — every one of them is also called
`GatedSpace-personal-1.16.0-arm64.exe`, so leaving two in the same folder is how
you hand someone the wrong one. Yish installs and reviews
the personal build himself; public ship only after he confirms
(`bun run ship 1.16.0 "<headline>"`, always `-R yzgershon/GatedSpace`). Do **not**
push `windows-port` to origin.

Build note: electron-builder's output dir gets held open by the virus scanner after
a build, so `rm -rf` on it fails and a second build into the same dir dies. Build
into a **fresh** `release-*` dir each time and copy the exe into `release/`.
Never pipe the build to `tail` — a failed build then reports exit 0. A build takes
~12 minutes, which is longer than a foreground tool call survives: run it detached.

**A build is not finished until it is in `release/`.** The `release-*` scratch dir
is a workaround for the file lock, nothing more; leaving the exe there means the
one place Yish looks is silently a version behind, which has now happened twice.
Every promotion is the same three steps: move the current `release/*-1.16.0-*.exe`
into `release/archive/` under a time-stamped name, copy the new one in, then
`sha256sum` both to prove what landed. Never leave two same-version installers
side by side in `release/` — they're all called `GatedSpace-personal-1.16.0-arm64.exe`,
so the only thing distinguishing them is which folder they're in.

## What this is

A VS Code-style session pane that renders the **real `claude` binary** as a chat
instead of a terminal. Same binary, so it keeps every capability (CLAUDE.md, skills,
subagents, MCP, hooks, subscription auth, the account switcher) — only the rendering
changes. It is NOT the old Chat pane, which is a separate API-key agent.

Full spec and design decisions: `apps/desktop/plans/20260724-claude-code-session-ui.md`
(the "Build log" section at the bottom is the running record).

Open it from the workspace **`+` menu → "Claude Session"**.

## Windows shells must be ABSOLUTE

Load-bearing, and invisible until it bites:

- **Windows spells it `ComSpec`.** `process.env` is case-insensitive there, but a
  plain-object snapshot of it is NOT — and the terminal base env is exactly such
  a snapshot. `env.COMSPEC` off that snapshot is `undefined` on every real
  machine. The same trap applies to `PATH` (stored as `Path`) and to any test
  that writes `process.env.PATH` and reads the key back.
- **Never hand node-pty a relative executable.** Its resolver
  (`path_util.cc get_shell_path`) tests the name against the CALLING process's
  cwd first and, on a hit, returns an EMPTY string rather than the path it just
  found. A pty-daemon whose cwd is `C:\WINDOWS\system32` therefore fails every
  `"cmd.exe"` spawn with `File not found:` and nothing after the colon. The
  daemon is detached and long-lived, so the cwd it happened to inherit decides
  whether terminals work at all until something replaces it — which is why this
  looked intermittent across installs rather than broken.

`resolveConfiguredShell` (host-service `terminal/user-shell.ts`) owns the first
half; `resolveExecutable` in `pty-daemon/src/Pty/Pty.ts` is the backstop for the
second. A spawn failure now prints the daemon's own cwd, since that is the fact
the message used to hide.

## Usage numbers: who writes them, and when

`<configDir>/cache/rate-limits.json` per profile is the only local source of
real subscription percentages. Two things write it: the CLI's **status line**
(which only renders in a terminal, never in the headless session pane) and our
own `/usage` refresh. Everything else — the dialog, the pane's header strip,
the composer's warning — only READS it.

That's why "it's stale" was never fixable by refetching harder: `usage.getStats`
re-reads a file, and re-reading a file nothing rewrites returns the same number
forever. Worse, the staleness was silent-but-confident — the stored percentage
outlived the window it measured, so a reset five-hour window still showed a full
bar. `main` now runs a **ten-minute ticker** (`startUsageRefreshTicker`) so every
account stays current whether or not a pane is open.

Two traps worth keeping:

- **`resets_at` must be written, not inherited.** `toQuotaSnapshot` used to omit
  it on the grounds that deriving an epoch from "Jul 26, 4:19am (America/New_York)"
  is a guess. The merge in `persist()` then preserved whatever epoch the status
  line last wrote, and `fmtResetIn` renders a past epoch — and a missing one —
  as "resets now". It isn't a guess when the phrase's zone is the machine's own
  zone; when it isn't, `parseResetLabel` returns null and the panel shows the
  phrase instead of a countdown.
- **The refresh cleans up after itself.** Each probe leaves a
  `<sessionId>.jsonl` holding nothing but `/usage` bookkeeping. At three accounts
  every ten minutes that's ~430 files a day, so `removeProbeTranscript` deletes
  the one file whose id that process just reported.

## Commits this pass (newest first)

- `1.17.2` **`/usage` in the composer palette could never work**: it reads the
  return of `usage.refreshLimits`, which returned null unconditionally unless
  given a `configDir` the caller never passed. The panel blamed "the session
  between turns" — for a command that never touches the session. Default now
  resolves the ACTIVE profile and returns its report; `all: true` is the
  dialog's every-account path
- `57df3d6a1` **1.17.1**: Windows terminals stop launching with a bare
  `"cmd.exe"` (see above). Also skips the login-shell env probe on Windows — it
  ran a POSIX `-i -l -c 'command env'` line against cmd.exe, so it could only
  fail, once per cache miss, into the log
- `9650a6d7b` **image attachments**: paste / drag-drop / `+` button, chips with
  name + dimensions, image-only prompts allowed. Probed first — a base64 image
  block in a stream-json user message IS seen by the model (solid-red PNG came
  back "Red"). Downscaled to a 1568px long edge; only DESCRIPTORS go in the
  replay buffer, never the bytes
- `df9b2ce60` clipped-output fade takes the surface colour from its caller; the
  composer's footprint becomes a spacer so the empty state stays centred
- `43421469a` **the layout pass**: full-width timeline, standalone dots (no rail),
  boxed prompt per turn, tool call as a header line, shells show IN/OUT, edits show
  a side-by-side diff headed by the line delta, searches show a hit count, Read
  shows no body. Mode + effort collapse into one popup; Shift+Tab cycles modes;
  Ctrl+Esc takes the caret; the composer floats over the timeline
- `fca4317d7` sidebar: Recent sessions in the rail, opening inside the workspace
- `67e7a0a41` prose stops sitting indented from the tool cards
- `b3fe74ce3` a restarted session stops rendering as dead
- `27153583d` a dead session offers Restart instead of leaving the pane dead
- `c3c880c5c` composer: app dropdown for mode; mouse can queue while running
- `01978c1ee` tool cards and subagent groups say what they were for
- `fca18a3d6` session tabs titled from the first prompt
- `b31070577` context-usage indicator in the header
- `b3d4ae7e2` @mention autocomplete for workspace files
- `ce8b04dcd` rate-limit chip in the header
- `a01ff7326` spawn failures and crashes surface as fatal notices
- `ce7f03cb1` settings grouped by what's being configured
- `30a15ca45` sidebar: Automations + Tasks & PRs move into the profile menu
- `77fd28f73` timeline laid out in turns (rail, tool cards own their output)
- `5f8beee11` fork instead of refuse; spawn without a shell
- `f1e49cf69` close the spawn-to-init hole in the two-writer guard
- `22e73ec7b` resuming a Claude session from the recent list opens the session
  pane (pane-owned session ids join the live check; panes take a cwd override)
- `5b15dd495` remote workspaces don't get a session pane — it spawns locally
- `0d2715d0f` the pane honors the user's Claude agent preset (command/args/env,
  filtered by `sanitizePresetArgs`)
- `5e411f3dc` two-writer guard — a resume id already live under another pane key
  starts fresh instead, and says so via a `local_notice` row
- `ab9af2b62` history from disk — panes persist their session id and repaint their
  stored transcript, so a restored layout resumes the real conversation
- `6f8d12dc6` mode change restarts the process with `--resume`, keeping the transcript
- `22c7e6840` live token streaming, stick-to-bottom scrolling, kill-on-close
- `45a002c04` session survives tab switches; effort slider wired for real

## Architecture, in one pass

- `shared/claude-session/events.ts` — typed stream-json protocol, derived from real
  captures. Two GatedSpace-only additions the CLI never sends: `local_user_message`
  (our echo of what we wrote to stdin) and `local_notice` (the app explaining itself).
- `shared/claude-session/timeline.ts` — pure incremental fold `applyEvent(state, event)`.
  Handles live SSE deltas (drafts that finalize in place) and stored transcripts
  (prompts arrive as bare strings in `user` events). No-op events return the SAME
  reference so React can skip renders.
- `main/lib/claude-session/transport.ts` — spawns claude, binds the account via
  `CLAUDE_CONFIG_DIR`.
- `main/lib/claude-session/session-manager.ts` — singleton; owns transports, the
  per-key **replay buffer**, and the session-id registry behind the two-writer guard.
- `main/lib/claude-session/transcript.ts` — reads a stored `.jsonl` back into events.
- `lib/trpc/routers/claude-session/` — start/restart/send/interrupt/stop/history +
  the `stream` subscription (replays the buffer before attaching live).
- `.../ClaudeSessionPane/sessionStore.ts` — renderer module store keyed by pane id.
  **This is why tab switches don't reset a session**; the pane binds via
  `useSyncExternalStore`.

## Rules worth not relearning

- Renderer subscribes through the **`electronTrpcClient` proxy**, never `electronTrpc`
  hooks inside the workspace tree ("No procedure found" context hijack).
- **Never two writers on one session id.** It silently destroys the newer copy's
  transcript; it happened twice (7/18, 7/19). The host has its own guard with a fork
  option; the session manager now has an equivalent one.
- Headless stream-json has **no click-to-approve, and no way to add one**.
  `--permission-mode manual` simply denies the tool, and this CLI has no
  `--permission-prompt-tool` flag. New sessions default to `bypassPermissions`
  so edits work.
- `/effort <low|medium|high|xhigh|max|auto>` is real and `ultracode` is accepted too
  (it needs an xhigh-capable model). There is no `--effort` spawn flag.
- `--resume` does **not** replay history as events, and keeps the same session id.

## Next

- **Approvals are not buildable against this CLI.** `--permission-prompt-tool`
  does not exist in it — checked `claude --help`. The only permission surfaces
  are `--permission-mode`, `--allowedTools`, `--disallowedTools` and `--tools`,
  so there is no click-to-approve to wire up. The nearest real feature is
  allow/deny tool lists in the composer. Don't promise interactive approval.
- **Model picker.** `/model` is a real slash command, but listing valid models
  needs a probe first — don't hardcode model ids.
- **Deliberate divergences from the reference screenshots**, each with a reason,
  so nobody "fixes" them by accident:
  - **No mic button.** GatedVoice owns dictation; a button that only looks like
    it listens is worse than none.
  - **Mode descriptions differ for "Auto".** The extension says it pauses for
    anything risky. `bypassPermissions` never pauses, so the copy says that.
  - **6 effort dots, not 5.** Yish specified low/medium/high/xhigh/max/ultracode.
  - **No Account & Usage modal.** The header's context and rate-limit chips carry
    the live signal; the full usage breakdown is a separate surface.
  - **Sessions list is a tab pane, not a rail panel.** See the next bullet.
- **Recent sessions now IS in the rail** (`fca4317d7`), but it opens a pane
  *inside* the workspace rather than a dialog in the rail — the liveness check
  that stops a plain resume of a terminal-held session only works in workspace
  context, and skipping it is the transcript-destroying case.
- **The agents toolbar stays terminals, on purpose.** There is no discrete
  "Claude button" to flip: the bar runs *presets*, which are multi-command
  recipes with execution modes (sequential / per-tab), a cwd override, and the
  ability to write into an already-focused terminal. One of them happens to run
  `claude`. Mapping that onto a single session pane would quietly drop most of
  what a preset is. If this gets revisited, it needs a design, not a swap.
- Usage panel (local `.jsonl` reads only — never poll).
- Rest of 1.17's shell work. Done so far: Automations + Tasks & PRs moved into
  the profile menu, settings regrouped. Not done: the activity-bar rail itself.
