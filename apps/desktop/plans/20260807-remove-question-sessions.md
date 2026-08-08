# Plan: take the question sessions back out

**Status: waiting on Yish's go-ahead. Nothing below has been done.**

> **REVISED 2026-08-07 after he answered.** His goal is a smaller install, and
> that inverts one recommendation below. **Group D is no longer "leave alone" —
> it goes.** See "The size finding" immediately after this. The rest of the plan
> stands. Group C (the transcript lock) still stays.

## The size finding, which changes the recommendation

The original plan said the host-service ACP code was invisible to him and not
worth the risk of removing. **That was true for behaviour and wrong for disk**,
which is the axis he actually cares about.

Measured on the installed 1.17.38:

| | |
|---|---|
| whole install | **2,535 MB** (the 503 MB figure is the *compressed installer*) |
| `resources\app.asar` | 1,203 MB |
| **`claude.exe`** | **225 MB** |
| `GatedSpace.exe` (Electron) | 191 MB |
| `resources\bin\superset.exe` | 92 MB |

`claude.exe` ships from `@anthropic-ai/claude-agent-sdk-win32-arm64`. **Nothing
in this repo declares that package.** It arrives purely as a transitive
dependency of `@agentclientprotocol/claude-agent-acp`, which only
`packages/host-service`'s ACP runtime imports. Drop the adapter and 225 MB goes
with it.

So the removal now includes the host-service side:

7. **Delete the ACP runtime** (`runtime/acp-sessions/`), its tRPC router, and
   its test lanes and fixtures.
8. **Drop `@agentclientprotocol/claude-agent-acp`** from `apps/desktop` and
   `packages/host-service`, and relock.

**Keep `@agentclientprotocol/sdk`.** Different package, types only, negligible
size — and `packages/session-protocol` uses it (`src/acp.ts`, and `HarnessKind`
in `src/state.ts`) for the timeline folding that the **ordinary stream-json
session pane also depends on**. Removing it is a real refactor of shared code
for no disk gain. Do not confuse the two packages.

### Not part of this, but found while measuring

Flagged, not started, needs its own decision:

- **~140 MB of other-platform binaries** ship on this ARM64 Windows build:
  `onnxruntime` for darwin-x64 (34 MB), darwin-arm64 (30 MB) and linux-x64
  (42 MB across two files), plus `duckdb` **win32-x64** (35 MB) alongside the
  win32-arm64 one that is actually used.
- **`app.asar` is 1.2 GB**, which is very large for an app bundle and worth a
  look on its own.
- `%APPDATA%\GatedSpace\network-logs` was **405 MB**, 362 MB of it one file from
  a single day, growing unbounded.

Asked for on 2026-08-07: he does not want the AskUserQuestion feature, wants
GatedSpace back the way it was before it went in, and wants **everything else
added since then still fully intact**.

---

## The thing that makes this small

**The ACP runtime in `packages/host-service` is not new and is not mine.** It
shipped in 1.17.36 and earlier, built for a phone client that does not exist in
this checkout. It is dormant: nothing starts an ACP session unless a client asks
it to.

So "go back to before the question feature" does **not** mean unwinding twelve
commits. What is actually new is a thin layer of desktop UI sitting on top of a
runtime that was already there. Take the UI away and the app is, from his seat,
exactly 1.17.36 plus the two things he does want.

## What has landed since 1.17.36, honestly sorted

Twelve commits. They are not one feature.

### Group A — the question feature itself. This is what goes.

| Commit | What it added |
|---|---|
| `bf6c80bb3` | question-card selection rules + the approved preview |
| `ee0713612` | `acp-transport.ts` — the renderer's connection to ACP |
| `f273b33de` | `QuestionCard.tsx`, and the personal-build gate |
| `8bde810d7` | `AcpSessionPane.tsx`, the registry entry, the context-menu item, `CardPersonal` naming |

All of it lives under one folder, `AcpSessionPane/`, plus two call sites.

### Group B — keep. He asked for these and they are unrelated.

| Commit | What it does |
|---|---|
| `1981fd9f2` | kills the ~2s freeze when switching back to the window |
| `45ff7c89a` | the active-pane ring, coloured per agent |

### Group C — keep. Protects his transcripts, nothing to do with questions.

| Commit | What it does |
|---|---|
| `cfca88da4` | the two-writer guard understands writers outside this process |
| `2704e736e` | session claims are a real file, not just in-memory |
| `f36bac743` | the ACP runtime takes the same claim; `session-lock` moved to `@superset/shared` |

**Do not drop these because they came out of the ACP work.** The transcript loss
that hit him on 7/18 and again on 7/19 was pane-versus-pane, not ACP. The
in-memory guard could not see a second GatedSpace process or a crashed one
holding a stale claim. The file-based claim can. That hazard exists whether or
not questions ever ship.

### Group D — invisible to him. Leave alone.

| Commit | What it touched |
|---|---|
| `52edfec45` | option descriptions (host-service + `session-protocol`) |
| `f4fd9d7a7` | ACP failures log instead of showing a bare "Internal error" |
| `e1874a63a` | `claude.exe` resolved inside `app.asar`, where it can never execute |

These change a runtime he will never start. Ripping them out means editing
`acp-sessions.ts` in three places and retesting the ACP lanes, for a result he
cannot see. That is risk spent on tidiness. **Recommendation: leave them.** If
the code being present bothers him, that is a separate cleanup pass with its own
verification, not part of this.

---

## The work

Recommended: **remove the UI, leave the dormant runtime.**

1. **Delete `AcpSessionPane/`** — six files (`AcpSessionPane.tsx`,
   `QuestionCard.tsx`, `acp-transport.ts`, `question-card.ts`, their two test
   files, `index.ts`).
2. **Remove the registry entry** — the `acp-session` pane kind in
   `usePaneRegistry.tsx`.
3. **Remove the entry point** — the `split-with-questions` block in
   `useDefaultContextMenuActions.tsx`, and with it the `acpSessions.list`
   capability probe that runs on every workspace mount.
4. **Rename the installer back** to `GatedSpace-personal-<version>-<arch>.exe`
   in `electron-builder.ts`. `CardPersonal` was named for the card.
5. **Keep `isPersonalBuild()`** in `build-channel.ts` and its `define` in
   `electron.vite.config.ts`. It is 24 lines, it gates nothing on its own, and
   the next internal-only thing would just need it rebuilt. Open to dropping it
   if he would rather have the diff clean.
6. **Keep both card preview HTML files.** His call, 2026-08-07: they are not
   part of the app, so they cost nothing shipped.

Everything else stays exactly as it is.

### One trap, and it would look exactly like a broken removal

Saved layouts persist a pane's `kind` string. There is **no pruning of unknown
kinds** — `Pane.tsx:276` renders a pane reading `Unknown pane kind: acp-session`
and nothing cleans it up. So if he has a question pane open in a tab when he
installs the build that removed the kind, he opens the app to a broken-looking
pane and every reason to think the removal went wrong.

**Checked, and it does not apply to him.** The persisted stores —
`~/.superset/tanstack-db.sqlite` and its `-wal`, `local.db`, `window-state.json`,
`app-state.json` — were read with shared access while the app held them open,
and the literal string `acp-session` appears **zero times** in any of them. He
has no question pane saved, so there is nothing to close and no pruning to build.

(The first attempt at this read returned zeros because the files were locked and
the read had silently failed. Zeros from a failed read look exactly like zeros
from a clean store. Open with `FileShare::ReadWrite` and check the byte count is
non-zero before trusting the result.)

If it ever does come up: either close the panes before installing, or drop
unknown-kind panes on restore. The second is a real behaviour change in shared
pane code and wants its own tests.

### The alternative, and why not

Reset the branch to the 1.17.36 tree and replay the freeze fix, the ring and the
lock work on top. Cleaner history, but it rewrites a branch that already carries
the public snapshot lineage, invites conflicts in `session-manager.ts`, and
buys nothing he can see. **Not recommended.**

### The cheapest option, if he wants to think about it longer

Remove step 3 only — the context-menu item. The feature becomes unreachable in
about a minute, and it is one line to put back. The code stays in the bundle and
the probe stops running. Worth naming, but it is not what he asked for.

---

## Proving nothing else broke

`bun run dev` cannot run while the installed app is open, so a real install is
the only proof. Before the build:

- `bun run lint` clean, `bun run typecheck` clean on desktop + panes
- `bun test apps/desktop` back at its **37-fail** baseline, not above
- shared session-lock units still green

After installing (this is his checklist, not mine):

- session panes open, resume and fork as before
- terminals and the browser pane unaffected
- the active-pane ring still there, still the agent's colour
- no freeze coming back to the window
- right-click a pane: **no "Split with Questions Session"**

## Ways back

Two, both already on disk:

- `C:\Dev\_gatedspace-rollback\` — 1.17.36 personal installer with its SHA256,
  all 424 transcripts, `%APPDATA%\GatedSpace`, `~/.superset`
- `apps/desktop/release/` — 1.17.39, the build with the feature still in

Nothing in this plan touches either.

## Decisions taken, 2026-08-07

His answers, verbatim in substance:

1. **Remove the questions UI and everything associated with it.** Reason given:
   he wants GatedSpace to be the smallest file that still does everything he
   wants, so unused question-related megabytes are not acceptable. This is what
   pulled Group D and the adapter into scope.
2. **Installer name goes back to `GatedSpace-personal-<version>-<arch>.exe`.**
3. **Keep the preview HTML files** — not part of the app, so harmless.
4. Moot: he has no question panes saved (checked, see above).

Still needs his explicit go-ahead before any of it starts, because the scope
grew after he answered.

## What he loses

Nothing he uses. The question card never reached a state he saw working: 1.17.37
failed outright, and .38 has it behind a context-menu item he does not want.
