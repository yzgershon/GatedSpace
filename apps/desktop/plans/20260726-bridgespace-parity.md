# BridgeSpace parity plan

Derived from a full architecture analysis of BridgeSpace 3.4.16 (BridgeMind), a
Tauri-based competitor, on 2026-07-26. Evidence: its embedded Tauri ACL manifest
(198 IPC commands), 93 extracted Vite bundles, its SQLite migration DDL, its live
JSON log, its config directory, live read-only probing of its loopback HTTP
server, and screenshots of the running app.

**Nothing from BridgeSpace is copied.** These are independently implemented
behaviours, chosen because the analysis showed them to be correct. Where a
specific constant is theirs (an interval, a byte cap), it is treated as a
starting point to be measured, not a value to inherit.

## The strategic frame

GatedSpace is AHEAD where it is hardest: a real chat renderer over `stream-json`
with a diff view, usage strip and slash palette. BridgeSpace runs agents as raw
PTYs and has no equivalent — no chat, no diff viewer, no approval UI.

The gaps are **platform depth**, not agent UX: Windows shells, command history,
crash forensics, voice, mobile. Almost all are small. None of this work should
trade away time on the session pane, which is the actual lead.

**Rejected outright:** migrating to Tauri/Rust. It is a rewrite of everything in
`main/` and `packages/host-service/`, it would freeze the differentiator for
months, and the 528 MB installer costs the current user base nothing. Revisit
only if distribution to strangers becomes a goal. Keep the main↔renderer seam
narrow so that option stays open.

---

## Phase 1 — Terminal & shell (the foundation)

Everything in Phase 4 depends on this. It is also the largest single gap: a
Windows-first product with no Windows shell integration.

| # | Item | Est | Files |
|---|---|---|---|
| 1.1 | **PowerShell shell integration** — emit OSC 133 `A/B/C/D` + `OSC 9;9` cwd from a generated `profile.ps1`, hooking PSReadLine's Enter and replacing `prompt` | S | `host-service/src/terminal/shell-launch.ts`, `env.ts` |
| 1.2 | **Full OSC 133 for POSIX shells** — we emit `A` only; add `B`/`C` pre-exec and `D;<exit>` | S | `shell-launch.ts` |
| 1.3 | **Windows default shell → PowerShell** — `cmd.exe` today | S | `user-shell.ts`, `main/lib/terminal/env.ts` |
| 1.4 | **Login-shell PATH resolver cache** — probe `$SHELL -lic` once per run, memoise, log the resolution source, add a fast-shell escape | S | `clean-shell-env.ts`, `env.ts` |
| 1.5 | **Never touch user dotfiles** — audit that our rc file sources theirs, never the reverse | S | `shell-launch.ts` |
| 1.6 | **Elevated terminal** — "run as administrator" for a pane | S | `host-service/src/terminal/terminal.ts` |
| 1.7 | **Custom wheel handler** — translate wheel to cursor keys in alt-screen TUIs that lack mouse tracking | S | `renderer/lib/terminal/` |
| 1.8 | **Copy-on-select + strip box chrome** — strip TUI box-drawing when copying out of an agent pane | S | `renderer/lib/terminal/` |
| 1.9 | ~~OSC 52~~ — **ALREADY EXISTS.** `ClipboardAddon` + a UTF-8-safe `Utf8Base64` codec replacing the addon's broken default (#4839) | — | — |
| 1.10 | **WSL as a first-class shell** — distro enumeration, UNC↔Linux paths, dual cwd | M | `host-service/src/terminal/` |

## Phase 2 — Robustness

Aimed at failures we already have: native ARM64 crashes 1–3×/day, and a shared
`~/.superset` touched by two installs.

| # | Item | Est | Files |
|---|---|---|---|
| 2.1 | ~~Ownership stamp on shared state~~ — **DROPPED, the bug does not exist here.** See below | — | — |
| 2.2 | **Crash sentinel** — heartbeat file with pid/release/bucketed diagnostics and `expected_exit` stamped around quit and updater restart | S | `main/index.ts`, new `main/lib/crash-sentinel.ts` |
| 2.3 | **Renderer recovery watchdog** — catch paint failures by message AND stack; repaint on focus and DPR change | S | `renderer/lib/terminal/` |
| 2.4 | **Write-queue back-pressure telemetry** — counters + a report hook. NOT drop-and-mark; see the correction below | S | `renderer/lib/terminal/write-coalescer.ts` |
| 2.5 | ~~Single-writer log sink~~ — **DROPPED, verified not a defect here.** See below | — | — |
| 2.6 | **Restore budget + deferred tier** — NOT STARTED. Premise differs; needs investigation first, see below | M | `terminal-host/`, `daemon/daemon-manager.ts` |
| 2.7 | **Watch + adaptive poll** — `fs.watch` for latency, polling for correctness, TTL seen-set that un-marks on read failure | S | wherever we watch files |
| 2.8 | **Batched IPC variants** — plural forms alongside singular | S | `lib/trpc/routers/` |
| 2.9 | **Slow-IPC instrumentation** — log round trips over a threshold with ms, bytes, kind | S | `lib/trpc/` |

## Phase 3 — Agents

| # | Item | Est | Files |
|---|---|---|---|
| 3.1 | **Agent Sessions panel** — every run with account, age, and a copy-pasteable resume command | S | `main/lib/claude-sessions/`, new settings section |
| 3.2 | **Agent registry** — mostly ALREADY EXISTS; only resume syntax was missing. See below | M→S | `packages/shared/src/agent-resume.ts` |
| 3.3 | **Resume degrades on missing transcript** — `--continue` instead of refusing; keep the hard refusal for the live/two-writer case | S | `claude-session/resume-claim.ts` |
| 3.4 | **In-app multi-account + rate-limit failover** — absorb `claude-acct.cmd` | M | `main/lib/claude-profile.ts`, `session-manager.ts` |
| 3.5 | **Verified agent launch** — prompt-settle, watchdog retry, verify by banner or child process | M | `session-manager.ts`, `transport.ts` |
| 3.6 | **Handoff engine** — session → Markdown, packed failure-first under a byte budget with omission markers | M | new |

## Phase 4 — Data & reach

| # | Item | Est | Files |
|---|---|---|---|
| 4.1 | **Command history store** — SQLite fed by 1.1/1.2; frecency suggestions in the command palette; denylist | M | `packages/local-db`, `commandPalette/` |
| 4.2 | **Loopback mobile bridge** — token auth checked BEFORE routing, one unauth `/health` (no hostname), size + concurrency caps, pinned CORS, rotate/revoke | M | new `main/lib/mobile-bridge/` |
| 4.3 | **Voice into the focused agent** — token handshake + inject-poll so GatedVoice targets the pane, not the OS keyboard | M | `SessionComposer.tsx` + main IPC |
| 4.4 | **Browser capture → agent** — screenshot the pane into the composer as an image chip | S | `BrowserPane/`, `SessionComposer.tsx` |
| 4.5 | **DOM element picker** — click an element, hand selector + styles + markup to the agent | M | `BrowserPane/` + preload |

## Phase 5 — UI

| # | Item | Est | Files |
|---|---|---|---|
| 5.1 | **Pane rename + accent + focus-tinted header** — inline rename, per-agent accent, tint border AND header | S | `packages/panes/`, pane headers |
| 5.2 | ~~Pane-count badge~~ — **DONE 2026-07-28. The block was a wrong source**, not missing data: `v2WorkspaceLocalState` persists `paneLayout` for every workspace and the sidebar already loads every row | — | — |
| 5.3 | **Version badge in the title bar** | S | `TopBar/` |
| 5.4 | ~~Settings search~~ — **ALREADY EXISTS, and is finer-grained than theirs.** See below | — | — |
| 5.5 | ~~Independent scale axes~~ — **ALREADY TRUE.** Terminal font size lives in `lib/terminal/appearance`, app zoom in `useZoomFactor`; they were never coupled | — | — |
| 5.6 | ~~Starter prompt suggestions~~ — **DONE 2026-07-27.** `STARTER_PROMPTS` in `SessionView.tsx`; this row was simply never struck through | — | — |
| 5.7 | **Notification matrix** — type × role, debounced sound | M | `settings/ringtones/` |
| 5.8 | **Semantic Tailwind tokens** — sidesteps the `@custom-variant dark` class of bug | M | `packages/ui/` |

## Phase 6 — Cleanup

| # | Item | Est |
|---|---|---|
| 6.1 | **Delete dead Chat pane code** — pane and menu entry are gone; the implementation is not | S |
| 6.2 | **Resolve `apps/desktop/preview/index.html`** — untracked, and the only repo-wide lint error | S |
| 6.3 | **Fix `bun run lint` on Windows** — `scripts/lint.sh` dies with `bunx: command not found`, so the lint gate does not run on the primary platform | S |
| 6.4 | **Decide on the Expo mobile app** — cloud-only, while the public build is local-only, so it is unreachable for actual users | — |
| 6.5 | **Audit for tests that die on import** — several never run at all; see below | M |

## Deliberately not doing

- **Tauri/Rust migration** — see the strategic frame.
- **SSH client** — large, and `settings/hosts/` covers remote work differently.
- **Swarm / multi-agent orchestration** — large, and the chat-rendered session pane is the better bet for the same effort.

## Order of execution

1 → 6 → 2 → 3 → 5 → 4. Phase 1 unblocks Phase 4; Phase 6 is cheap and clears
the lint gate so everything after it can be verified properly.

## Reassessment after working the list

**Ten of roughly twenty borrowed items did not apply.** Not "were hard" — did not
apply. They were dropped, reversed, or found already present, usually in a better
form:

| Item | Outcome |
|---|---|
| 2.1 ownership stamp | Impossible here — DB and socket both derive from `SUPERSET_HOME_DIR` |
| 2.4 drop-and-mark writes | Would have been a DOWNGRADE; ours flushes and loses nothing |
| 2.5 single-writer log | Not a defect — 0 interleaved records in 22,301 real lines |
| 2.6 restore budget | Premise differs; we adopt live PTYs rather than respawning |
| 3.2 agent registry | Already exists as `builtin-terminal-agents.ts` |
| 3.3 resume degradation | Probably N/A; we enumerate sessions BY transcript |
| 5.2 pane-count badge | Blocked on data availability, not effort |
| 5.4 settings search | Already exists, and indexes 70 settings vs their 16 sections |
| 5.5 independent scale axes | Already true |
| 1.9 OSC 52 | Already exists, with a UTF-8 fix theirs lacks |

**The lesson, stated plainly so the next pass starts here:** the competitive
analysis was accurate about what BridgeSpace *does* and consistently wrong about
what we were *missing*, because it could see their solutions and not our
architecture. Every item above cost minutes to check and would have cost hours —
or a regression — to implement on faith. Check the premise first, every time.

**What genuinely landed**, and note how little of it came from the impressive-
looking parts of the report:

- Windows shell integration (1.1–1.3, 1.5) — the one large, real gap
- Crash sentinel with bucketed forensics (2.2) + a reader (`diagnostics`)
- Repaint watchdog for stale drawing surfaces (2.3)
- Write back-pressure telemetry (2.4, reshaped) and slow-IPC reporting (2.9)
- One source of truth for resume syntax (3.2, reshaped)
- Copyable resume commands (3.1), starter prompts (5.6), version badge (5.3)
- Lint gate that runs on Windows at all (6.2–6.3)
- **The dead-test discovery (6.5)** — which came from doing the work, not from
  BridgeSpace

**What actually remains**, all of it either genuinely absent or genuinely large:

- 1.6 elevated terminal, 1.8 copy-on-select + strip box chrome, 1.10 WSL
- 4.1 command history store (needs Phase 1 exercised first)
- 4.2 loopback mobile bridge, 4.3 voice, 4.4/4.5 browser capture + element picker
- 5.1 pane rename + per-agent accent — the biggest visible win left
- 6.1 Chat pane removal (M), 6.5 dead-test audit

## Build log

### 2026-07-27 — Phase 1 foundation + Phase 6 gate

**`74501da73` — shell integration**
- **1.1 PowerShell integration** DONE. Generated `profile.ps1` in `~/.superset/pwsh/`,
  dot-sourced via `-NoLogo -NoExit -Command` with the dot-source in try/catch so a
  broken profile degrades to a plain shell. PSReadLine Enter handler emits `133;B`
  + `133;C`; a replaced `prompt` emits `133;D;<code>`, `9;9;<cwd>`, `133;A`.
  `$LASTEXITCODE` is native-only and stale for cmdlets, so `$?` is read as well.
  cwd emitted only for the FileSystem provider.
- **1.2 Full OSC 133 for POSIX** DONE. zsh uses real preexec/precmd; bash uses a
  guarded DEBUG trap. Both now emit B/C/D and `9;9` — previously `A` only.
- **1.3 Windows default shell → PowerShell** DONE, with cmd.exe retained as the
  fallback when the in-box PowerShell isn't found.
- **1.5 Never edit user dotfiles** — audited, ALREADY CORRECT. The bash rcfile and
  zsh wrappers source the user's files; nothing writes into them.
- `getShellName` now strips `.exe` and splits on both separators, so
  `powershell.exe` matches at all.

**`aec75d545` — lint gate**
- **6.3 `bun run lint` on Windows** DONE. Entry point is now `scripts/lint.ts`;
  biome runs everywhere, the four `.sh` checks run via an explicitly located Git
  Bash and are skipped loudly by name when no POSIX shell exists. `bunx` → `bun x`.
  Root cause of the recurring phantom lint errors also fixed: `core.autocrlf` was
  rewriting files to CRLF on checkout while biome mandates LF. Now exits 0.
- **6.2 `preview/index.html`** DONE — gitignored, which biome honours.

### 2026-07-27 — Phase 2 robustness, then Phase 4.1

**`b190dd149` — 1.17.4**
- **2.2 crash sentinel** DONE. A heartbeat file the next launch reads, so a hard
  kill is visible after the fact. Diagnostics are BUCKETED (memory, terminal
  count, runtime) rather than exact — the question a crash report answers is
  "was it huge / busy / long-running", and a bucket answers it without keeping a
  precise machine fingerprint on disk.
- **2.3 repaint watchdog** DONE. xterm's canvas can be left blank by a DPI change
  or a compositor hiccup; the watchdog repaints on focus, visibility and DPR
  change. The matchMedia query is RE-ARMED after each change — a DPR query only
  fires for the resolution it was created at, so a watchdog that doesn't re-arm
  works exactly once.
- **2.7 slow-IPC reporting** DONE. tRPC calls over 750ms are reported.
  Subscriptions and cancellations are exempt: a subscription is *supposed* to
  stay open, so timing it measures how long the user left a pane open.
- **3.1 session resume commands** DONE via `@superset/shared/agent-resume` —
  one definition of "how do you resume this agent", where there were two.

**`dcd97ec6b` / `33978e301` — reading the markers back**
- Scanner is OBSERVE-ONLY: it copies out of the stream and never alters the
  chunk. Anything else would put a parser between the shell and the screen.
- Handles both OSC terminators (BEL and `ESC \`), caps payloads at 4KB, and keeps
  per-session resumable state — a marker split across two reads is the normal
  case, not the edge case.
- The command TEXT needed its own marker. VS Code's `633;E` looked like the
  obvious fit until its source showed percent-encoding I hadn't implemented, so
  claiming compatibility would have been a lie the first time someone typed a
  semicolon. Ours is `777;superset-cmd`, with its own encoder — and the encoder
  was verified by running the GENERATED function under real bash, which is how
  the first escaping scheme was caught doing nothing at all.

**`abe4ee957` — the store**
- Rows are assembled in the pty-daemon because `Server.wireSession` is the one
  place every chunk passes through whichever client is subscribed. In either
  client, the other client's terminals would record nothing.
- JSONL, not a database. The daemon is a separate process with no store of its
  own; a DB would mean a schema across a process boundary, migrations run from
  two places, and a lock. A torn final line costs one row.
- **Denylist from the start, dropping whole rows rather than redacting.** Shell
  history is a classic place secrets leak — plain text, searched and displayed
  long after anyone remembers typing them. A redacted row saying "you ran
  something secret at 14:02" has no use worth the risk of redacting wrong.

**`d46fa82b1` — reading and ranking**
- Frecency with two rules that matter more than the formula: repetition counts in
  DISTINCT DAYS (forty runs while debugging one afternoon is not a habit), and
  interrupt exits 130/143 count as SUCCESS (that is how a dev server is *ended*,
  not how it fails).
- A test caught a real design bug: I had summed a per-run recency weight, which
  smuggles raw frequency back in through a second door and lets that same
  afternoon out-rank ten days of daily use. `Math.max`, not `+=`.
- **6.5 partially done, and it found something.** `SidebarSessionsPanel.test.ts`
  had NEVER RUN — it imports the panel, which builds a tRPC client at module
  scope needing a preload global. The dead coverage was for `liveSessionKeys`,
  the exact rule whose failure destroyed transcripts on 7/18 and 7/19. Pure
  helpers extracted to `session-list-helpers.ts`; 12 tests now run, 9 of them
  previously dead. Nine more renderer "errors" still to audit.

**`f1772c1f8` — sidebar collapse**
- Collapsed width was 52px against a `w-12` (48px) rail, so 4px of panel stayed
  visible. Now matched, and the transition animates.

**1.17.5 build** — the first build containing any of the capture chain. Nothing
was ever recorded before it: the wrappers regenerate at app launch, so the
`777;superset-cmd` marker does not exist in a running 1.17.4. The palette surface
(4.1's remaining half) was deliberately NOT built on top of unverified capture —
`~/.superset/terminal-scrollback/command-history.jsonl` has to fill with sensible
rows first.

### 2026-07-27 (later) — 1.17.5, first real data, then 4.1 / 5.1 / 6.5

**1.17.5 shipped the capture chain, and the data answered three questions.**

Two came back green. The `$?` fallback records a failing CMDLET as a failure
(`Get-ChildItem` on a missing path, exit 1) — that was the untested half of the
exit-code logic, since `$LASTEXITCODE` only tracks native programs. And the
denylist held against a real shell: `$env:MY_TOKEN = "abc"` emitted a marker in
the raw stream and produced no row.

One came back red. Every backslash in the stored command text was doubled
(`Get-ChildItem C:\\NoSuchFolder`) — an emitter-side escape with no decoder,
left over from the POSIX scheme already removed for doing nothing. On Windows
that made the stored text wrong more often than right. Fixed in `40d031658`,
verified by running the sanitize chain out of the GENERATED profile under real
PowerShell.

Still unanswered: **Ctrl-C**. The test command ran without its argument and
died on its own in 37ms, so there was nothing to interrupt. The success-on-
interrupt rule uses 130/143, which are Unix signal conventions; Windows almost
certainly reports something else, and until a real interrupt is recorded that
rule is decoration on this platform.

Also learned, and now in HANDOFF: **installing a new build does not load new
daemon code.** The supervisor compares against `packages/pty-daemon/package.json`
(0.2.5), not the app version, so a daemon-side change ships with the two equal
and the old process adopted silently. Auto-update cannot fix it on Windows —
handoff is fd-based, ConPTY has no inheritable master fd, and it defers whenever
live sessions exist. Restart the daemon after any build that changes daemon code.

**`564b997a5` — 4.1 palette surface.** Built only after capture was verified, on
purpose. Tails the JSONL rather than reading it whole (frecency halves weekly,
so the far end of an 8MB file cannot affect the ranking), discards the fragment
at the window boundary, and caches on size AND mtime. Selecting an entry WRITES
the command to the focused terminal rather than running it — recall is the
value, and executing from a fuzzy-matched list is how someone runs last week's
`rm` in this week's directory. Crosses from the app-wide palette to the
workspace-owned terminal through an intent store, matching the four already in
the codebase.

**`18741b32b` — 5.1, half of it.** Double-click a pane title to rename. Clearing
restores the derived title; committing the displayed name does nothing, since
otherwise Enter would pin a pane to a name that merely matches right now and
stop it tracking what it goes on to run. The per-agent accent and focus tint are
NOT done: that half is colour on every pane header, the standing rule is to
preview a visual change first, and nobody was around to look.

**`6d1d68dc7` — 6.5, and it found a real hole.** Five of the 47 desktop failures
were not environmental: the codex hook command branches by platform, and the
tests asserted the POSIX form unconditionally — so the branch that exists ONLY
for Windows was verified only where it never runs, and was permanently red
where it does. Now one exported `buildCodexHookCommand` used by both sides.
2319 → 2324 passing, 47 → 42 failing.

The question that started 6.5 is answered: **every test file on disk now runs.**
233 of 233 in desktop, files-found equals files-run in shared, panes, pty-daemon
and host-service. The `SidebarSessionsPanel` failure mode — a file that errors on
import and is silently skipped, taking its coverage with it — exists nowhere in
the repo right now.

**A fix attempted and reverted.** `resolvePath` returns mixed separators on
Windows (`C:\Users\me/Documents/file.ts`) because the `~` branch is string
surgery that never reaches `path.resolve`. Normalizing looked obviously right
and took the file from 8 failures to 20: other tests in the same suite pin the
contract "an absolute path is returned unchanged", and on Windows `normalize`
rewrites a POSIX absolute path. The mixed separator is cosmetic and Node accepts
it; the contract is not. Left alone deliberately.

**`db75c558c` — and then the pile gave up a second, worse one.**
`selectExternalWorktreesForImport` compared paths with `===`. On Windows git
reports POSIX separators while everything from Node uses backslashes, so both
filters were comparing two spellings of the same directory and concluding they
differed. Importing a chosen set of worktrees therefore selected NOTHING, and
the main repo was never excluded — it was eligible for import as one of its own
worktrees. The integration test asserted path SPELLINGS, which is precisely what
let it hide: it failed for a reason that looked environmental.

**Revised conclusion about the pile.** It started as "47 environmental
failures". Two real Windows defects were inside it. The remaining 36 do mostly
`execFileSync` bash scripts or assert Unix mode bits and cannot pass here, and
those want `skipIf(win32)` so CI keeps covering them where they apply. But the
lesson is the opposite of the one I started with: a permanently-red suite does
not just fail to catch NEW regressions, it actively camouflages OLD ones. Check
each failure before gating it. A test comparing path spellings or asserting a
POSIX-shaped string may be describing a real bug rather than a hostile platform.

### 2026-07-28 — 1.6, 5.7, 5.8, 4.3, and 6.1 partially

**`843771832` — 1.6 + 5.7.**
- **1.6 elevated terminal** DONE, as a SEPARATE WINDOW, which is the whole
  design decision. An elevated pane is not safely buildable: `ShellExecuteEx`
  with `runas` cannot carry `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`, so an
  elevated child cannot attach to a ConPTY we own; and the broker-over-named-
  pipe workaround hands unelevated code a keyboard into an admin shell, which
  is a UAC bypass primitive rather than a feature. Windows Terminal reached the
  same conclusion and opens elevated profiles in their own window. The cwd
  travels as base64 `-EncodedCommand` so a path containing a quote cannot break
  out of the launcher's command line.
- **5.7 notification matrix** DONE as event type × CHANNEL. The plan said
  "role"; there is no role concept in this codebase, and the choice people want
  is "sound, banner, both, or neither". Defaults reproduce the old behaviour
  exactly. Sound throttles leading-edge in two buckets so a burst of
  completions makes one noise but a completion can never swallow a permission
  prompt landing in the same window. Gated on BOTH notification paths — the
  renderer's lifecycle handler and the main-process `NotificationManager`,
  which the hook port drives and which would otherwise have ignored the setting
  entirely. A test caught `parseNotificationMatrix` shallow-copying its
  defaults, which let any caller's mutation rewrite the module-level constant.

**`8bc736dac` — 5.8.** `packages/ui/globals.css` was a strict SUBSET of the
desktop's theme: no success, warning, info, tertiary, highlight or
destructive-foreground. Nothing in packages/ui uses them today, so this closed
a trap rather than a live bug — a shared component using `bg-warning` works
because the desktop's Tailwind build scans packages/ui with the DESKTOP's
tokens, and would render unstyled in any other consumer. The test is the
durable part: it catches a token aliased with no value, a token defined in one
theme and not the other, and packages/ui falling behind again. Verified
non-vacuous by breaking each case.

**NOT done in 5.8, deliberately:** the 298 hardcoded palette utilities
(`bg-emerald-500` and friends) across 89 files. `--success` is `#4bb377` and
`emerald-500` is `#10b981`, so swapping them is a visible design change, not a
refactor. Wants review, not a sed.

**`53d279cb3` — 4.3, reversed.** No desktop voice routing (Yish's call, and the
right one). The phone's own recogniser produces text in the bridge page; only
text crosses the network, so there is no audio path on the desktop.

The blocker that shaped it: `SpeechRecognition` requires a SECURE CONTEXT and
the default LAN link is plain HTTP, so the button could never have appeared.
Hence a Tailscale (HTTPS) mode where Tailscale terminates TLS with a real
certificate for the `ts.net` name. That also closes something 4.2 shipped: on
plain HTTP the bearer token crosses the network in the request line of every
call, which on school Wi-Fi means anyone capturing traffic can lift a
credential that drives an agent with a shell.

Needs HTTPS enabled once in the Tailscale admin console — a real decision,
since it publishes machine names to public CT logs — so the error path names
the fix and the tradeoff. Quit also had to change: both quit paths called
`stop()` without awaiting and `exitImmediately` calls `app.exit(0)` on the next
line, so an async teardown would never have run and the serve mapping would
have outlived the app.

### 6.1 — what is actually dead, established by reading rather than guessing

The previous correction said to investigate before touching. Doing so found
the Chat pane is **not one thing**, and most of it is live:

| Path | Verdict |
|---|---|
| v2 pane registry | Registers `session`, `file`, `diff`, `terminal`, `browser`, `comment`. **No `chat`.** An unregistered kind renders "Unknown pane kind: chat" — no crash, just a dead pane |
| v2 context menu "Split with New Chat" | **Was broken.** Created `kind: "chat"`. Fixed to `session` |
| v2 `SPLIT_WITH_CHAT` hotkey | Already created `session`. The menu item advertised this very shortcut and did something different — only the menu was wrong |
| v2 `useWorkspacePaneOpeners.addChatTab` | **Zero callers.** Removed |
| v1 `stores/tabs` `addChatTab` | **LIVE** — v1 `EmptyTabView`, `GroupStrip`, `workspace/$workspaceId/page.tsx` |
| v1 `screens/main/.../ChatPane/` + `components/Chat/` | **LIVE** |
| `agent-session-orchestrator` chat-adapter | **LIVE**, via the v1 tabs store |
| `appendLaunchesToPaneLayout` chat branch | **NOT dead.** `host-service/trpc/router/agents/agents.ts:233` genuinely returns `{ kind: "chat" }` |
| `useConsumeAutomationRunLink` | Unresolved; opens a chat pane by `chatSessionId` |

**Why v1 still matters.** Both UIs are wired, and `useIsV2CloudEnabled` decides
between them. The fork's local session sets `createdAt: now`, which lands in
the v2-only cohort, so GatedSpace runs v2 — but Experimental Settings still
exposes an explicit v1 opt-out, and a mismatch renders
`CrossVersionMismatchState` rather than redirecting. So v1 is reachable, and
deleting its Chat pane would break it for anyone who flips that switch.

**What 6.1 still needs**, and it is a project rather than a cleanup: decide
whether v1 is supported at all. If it is being retired, the Chat pane goes with
it and this becomes large but simple. If it is staying, the chat agent kind
needs a v2 destination — most likely the session pane — before
`appendLaunchesToPaneLayout` and the automation run link can be touched.
Neither question is answerable from the code alone.

### Corrections to this plan, from contact with the code

- **6.1 (delete dead Chat pane) is NOT S.** `ChatPane` is referenced from the
  agent-session-orchestrator and its adapter, PR-flow dispatch, automation
  run-link consumption, the default context menu and `start-agent-session`, plus a
  whole `renderer/components/Chat/` tree. Removing it is its own scoped project
  with a real risk of breaking automations. Re-estimate M, and investigate what
  still routes through the chat adapter before touching it.
- **3.3 (resume degrades to continue) may not apply.** BridgeSpace keeps a DB row
  per agent run and stats `transcript_path` before resuming. GatedSpace enumerates
  sessions BY reading transcripts, so a missing transcript means the session is
  never listed rather than refused. Verify there is a real refusal path before
  implementing a degradation for it. The live/two-writer refusal in
  `resume-claim.ts` and `SidebarSessionsPanel.tsx` is correct and must not be
  weakened — it exists because of transcript loss on 7/18 and 7/19.

- **2.1 (ownership stamp) DROPPED — the premise was wrong.** BridgeSpace needed
  `app_instance` because its `history.db` sits at `~/.bridgespace/` while its PTYs
  are per-process, so a dev install's boot sweep could judge a prod install's
  agents by its own registry. GatedSpace cannot reach that state:
  `DB_PATH = join(SUPERSET_HOME_DIR, "local.db")` and the terminal-host socket
  path derive from the SAME directory. Two instances that share a daemon
  necessarily share the database and agree on `validWorkspaceIds`; two instances
  with different home dirs get different daemons and never see each other's
  sessions. Co-locating the store with the socket is the stronger design and it
  already rules this out. `reconcileOnStartup` killing sessions for
  workspaces absent from the DB is correct, not a hazard.

  Recorded because it was briefly presented as a live bug. It is not.

- **2.4 changed shape — copying their design would have been a DOWNGRADE.**
  BridgeSpace caps its write queue, DROPS bytes, and injects a truncation marker.
  GatedSpace's `write-coalescer` already caps pending bytes and, on overflow,
  **flushes synchronously**: memory is bounded exactly the same way, and not a
  single byte is lost. Losing agent output to save one frame is a far worse
  bargain than one unbatched write. The real gap was that overflow was
  completely silent, so a renderer persistently behind its PTY presented only as
  "the terminal feels laggy" with nothing to point at. Implemented as counters
  (`overflowFlushes`, `overflowBytes`, `peakBatchBytes`) plus an `onOverflow`
  hook, logged on powers of two so a sustained firehose reports a handful of
  times rather than thousands.

  Third plan item to change shape on contact with the code. The pattern is
  consistent and worth stating: BridgeSpace's solutions fit BridgeSpace's
  architecture. Read ours first, every time.

- **2.5 (single-writer log sink) DROPPED — measured, not assumed.** BridgeSpace's
  log is character-interleaved because two independent writers append to one
  file; roughly 4 of 230 records there are corrupt JSON. GatedSpace opens ONE
  append-mode fd (`openRotatingLogFd`) and hands it to a single child's stdio, so
  writes serialise at the file description. Scanned 22,301 lines of real logs
  across `pty-daemon.log`, `host-service.log` and `daemon.log`: **zero**
  interleaved records. Nothing to fix.

- **2.6 (restore budget) NOT STARTED — deliberately, and here is what to check
  first.** BridgeSpace RESPAWNS PTYs from a snapshot at launch, which is why a
  budget, a deferred tier and a circuit breaker earn their keep: each restore
  costs a process. GatedSpace does not respawn — the pty-daemon outlives the app,
  so `reconcileOnStartup` ADOPTS sessions that are already alive and only kills
  those whose workspace is gone. There is no per-session spawn cost to budget.

  The real cost here is on the renderer side: N panes means N xterm instances and
  N WebGL contexts. So the question to answer before writing anything is whether
  inactive tabs already stay unmounted. If they do, a deferred tier exists in all
  but name and this item is mostly done; if they don't, the fix belongs in pane
  mounting, not in the daemon.

  Not attempted blind because this is the session-restore path, which has
  already cost transcripts twice (7/18 and 7/19). A half-understood change here
  is far more expensive than a slow one.

  What DID land: the crash sentinel's verdict is now readable
  (`diagnostics.previousSession`), so whatever consumes it later has a source.

- **6.5 — there are tests that have never run, and they hide in the failure
  count.** Found while adding to `SidebarSessionsPanel.test.ts`: it imports the
  panel, the panel imports `renderer/lib/trpc-client`, and that builds a tRPC
  client at MODULE SCOPE which needs Electron's preload global. The import
  throws before any assertion executes, so the file reports as one failing file
  among the pre-existing ones — indistinguishable from background noise.

  What was dead there was the coverage for `liveSessionKeys`, the liveness rule
  whose failure direction caused transcript loss on 7/18 and 7/19. It had no
  working coverage at all while appearing to have some.

  Fixed for that file by extracting the pure helpers to `session-list-helpers.ts`
  (imports nothing) and pointing the test at them: 12 tests now run, 9 previously
  dead. The renderer suite still reports **9 errors** alongside its 19 failures,
  and at least some are this same import death.

  The audit: run the renderer suite, collect every file reporting an *error*
  rather than a failure, and for each decide whether to extract pure logic or
  stub the global. A dead test is worse than a missing one — it looks like
  coverage while asserting nothing.

- **3.2 was largely already done, and I had the wrong file.** The plan said
  "replace the seven `agent-wrappers-*.ts` files with one record". Those files
  install HOOKS into each agent's own config — a different concern entirely, and
  legitimately per-agent. The registry BridgeSpace has already exists here as
  `packages/shared/src/builtin-terminal-agents.ts`: declarative entries with id,
  label, description, command, promptCommand and promptTransport, built through
  a factory that fills defaults, shared by desktop and host-service.

  The genuine gap was narrower: resume syntax was branched in TWO places —
  `buildAgentResumeCommand` (host-service, when a PTY dies) and the sidebar's
  `resumeCommandFor` (the command handed to the user). Two copies of "how do you
  resume Codex" is one too many; they can disagree, and the second one written is
  the one nobody updates. Now `@superset/shared/agent-resume`, with both callers
  pointing at it.

  One asymmetry was preserved rather than tidied: Claude replays a user's
  configured launch args before `--resume`, Codex does not. That predates this
  work. Codex's configured command carries approval/sandbox flags and replaying
  them ahead of a `resume` subcommand is untested, so it is now an explicit
  `replayConfiguredArgs` flag with a test pinning both values, instead of an
  accident of two code paths. Refactor, not behaviour change — the existing
  resume-command tests pass untouched.

- **5.2 (pane-count badge) blocked on data, not effort.** BridgeSpace shows a
  count per workspace row because its workspaces are in-window tabs whose pane
  trees are all in memory. Here the dashboard sidebar lists workspaces across
  projects, while `stores/tabs` holds panes for the ACTIVE v2 workspace only —
  an inactive workspace's pane state lives in persistence and isn't loaded.
  A badge that appears on one row and not the others is worse than no badge.
  Doable, but it needs a count exposed from persistence first; that is the work,
  not the rendering.

- **5.5 (independent scale axes) ALREADY TRUE.** Terminal font size is its own
  setting under `lib/terminal/appearance`; app zoom is `useZoomFactor` and chrome
  counter-scales by `1 / zoomFactor`. They were never coupled. Nothing to do.

- **5.4 (settings search) ALREADY EXISTS and is BETTER than the thing it was
  copied from.** `settings/utils/settings-search` indexes **70 individual
  settings**, each with a description and keywords; `SettingsSidebar` has the
  search field, and `GeneralSettings` filters groups by per-section match count
  so you can see where the hits are before clicking. BridgeSpace indexes 16
  SECTIONS with a hand-written `keywords[]` on each. Recommending we copy theirs
  was recommending a downgrade in granularity.

### Follow-up worth doing soon

- `.gitattributes` with `* text=auto eol=lf`. `core.autocrlf=false` is set locally
  and fixes this checkout, but the durable fix is in the repo so it holds for
  Codex and any other machine. Deferred because it renormalises the whole tree.
