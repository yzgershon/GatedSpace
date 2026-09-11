# HANDOFF — GatedSpace

**Update this file before you stop working.** It is imported by `CLAUDE.md`, so
it loads into every session in this repo automatically — which means a stale
entry here is worse than an empty one. The previous version sat untouched for a
week claiming the latest release was 1.17.15 while public was on 1.17.31, and a
fresh session had no way to know it was reading fiction.

Keep it to *current state and live traps*. Permanent facts belong in
`AGENTS.md`; shipped history belongs in git.

---

Last updated **2026-08-12**. Branch `windows-port`, tree clean apart from two
untracked scratch files.

**Installed and running: 1.17.46** — verified from `GatedSpace.exe`'s
ProductVersion (`1.17.46.0`, written 2026-08-11 13:33), not inferred. He
confirmed quick-open works. **Not shipped**; public is still 1.17.45.

    apps/desktop/release/GatedSpace-personal-1.17.46-arm64.exe   302.3 MB
    SHA256 4A3DD57F815B592398DDFC3CC2F3E984B619E1D949FA9007A4B867B894E357A6

**That hash is the SECOND 1.17.46, and the first one is gone.** The 2026-08-10
build (`71CD4609E1D2BBF1C39D4E463E682906FE91A2D60CD1B58EE1AF30CFB7D4D83C`) was
overwritten on 2026-08-11 by a rebuild that added quick-open (`aa231d0ad`)
without bumping the version. That is exactly what this file tells you not to do
— two binaries claiming one version is what makes "the fix did not take"
undiagnosable. It caused no harm only because the older artifact was never
installed. **Bump to 1.17.47 before the next build.**

1.17.46 therefore carries four things: the bump (`816b31e18`), the second
blank-terminal attempt (`1b2d73ef8`), the three fixes in `602234746`, and
quick-open across folders (`aa231d0ad`).

**All four fixes were verified inside the PACKAGED asar, not in the source
tree** — the distinction that caught a silently-inert daemon fix once already.
`app.asar` reports version 1.17.46, and against
`release/win-arm64-unpacked/resources/app.asar`: `_charSizeService` in
`dist/renderer/assets/terminal-runtime-*.js` (the re-measure; the 26 hits in
`addon-webgl` are xterm's own), `terminal-parking` in the same chunk,
`truncateCloseReason` twice in `dist/main/host-service.js`, and `0.2.7` in the
daemon package chunk so the running 0.2.6 is marked stale.

**Verify an asar the same way or you will get a false clean.** `listPackage`
returns `\leading\backslash\paths` but `extractFile` wants the leading
separator stripped and the backslashes KEPT. Passing forward slashes throws for
every entry, and a loop that swallows that error reports "not found" for all
602 renderer files — which reads exactly like a build that lost the fix. Count
the files you actually read, not just the hits.

The build logged `output file is locked for writing (maybe by virus scanner) =>
waiting for unlock...` and then recovered. That is the benign case; the fatal
one is `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` (see the trap below). The only
build "errors" are pre-existing rollup `"use client"` warnings from
`@tanstack/react-query`; they are noise and predate this work.

**Latest public release: 1.17.45**, shipped 2026-08-09 19:09 UTC (snapshot
`2b07724de`, tag `desktop-v1.17.45`). Verified `isDraft: false` directly rather
than from the script's exit code, with all seven assets attached: both
versioned installers (x64 319 MB, arm64 317 MB), both stable-name aliases the
README links to, both blockmaps, and `latest.yml`. Public went 1.17.40 → .45 in
one release, so .41 through .44 never reached a user.

**1.17.45 did NOT fix the blank terminal**; he tested it and reported the pane
still blank. That is why `1b2d73ef8` exists.

**The blank-terminal fix in 1.17.46 is still UNCONFIRMED.** He installed .46 and
reported quick-open working — that is all he confirmed. He has said nothing
about whether a plain PowerShell pane now paints. Ask before claiming it, and
see the ordered checklist in the 1.17.46 section below.

The public installers are ~15 MB larger than the local personal build (302.4
MB). Expected: CI resolves optional platform packages this machine never
installed, so there is simply more there to prune. Not a defect, but do not
quote 302 MB as the public size.

Bump to 1.17.47 before the next build — never rebuild a version that already
has an artifact, or "the fix did not take" becomes undiagnosable.

The installed tree was spot-checked against the exclusions on 2026-08-09:
1,319.1 MB total (from 2,534.7), one locale file, zero loose `.map`, no
`node-pty/prebuilds/win32-x64`, no `onnxruntime` darwin — and
`agent-browser-win32-x64.exe` **present**, which is the deliberate exception
that would otherwise have left the sidebar browser with nothing to launch.

## Quick open reaches outside the workspace — SHIPPED in 1.17.46, confirmed

`aa231d0ad`, at his request: Ctrl+T could only see the open workspace, so
`C:\Dev\superset\HANDOFF.md` was unreachable from any other project. **He
installed 1.17.46 and confirmed this works.** Two behaviours:

- **Extra roots.** Folders listed in `~/.superset/search-roots.json` are
  searched alongside the workspace. His is `{"roots": ["C:/Dev"]}` — written
  with FORWARD slashes on purpose, because `"C:\Dev"` is invalid JSON (`\D` is
  not an escape) and a parse failure degrades silently to zero extra roots,
  which looks exactly like the feature not shipping. `normalize()` handles
  forward slashes on Windows fine.
- **Typed paths.** A query containing a separator is resolved as a path instead
  of fuzzy-matched, and pinned to the top of the results.

**The parent of each root is a resolution base, and that is load-bearing.**
Typing `Dev\superset\HANDOFF.md` while the configured root IS `C:\Dev` would
otherwise resolve to `C:\Dev\Dev\superset\...`. A test covers exactly this.

**No security boundary was touched, and none should be.** `readFile` already
permits absolute paths outside the workspace root by design — there is a test
named "reads files outside the workspace root" — while `writeFile` rejects them
and escaping symlinks are refused. So these files are readable but NOT editable
from another workspace, and `resolveTypedPath` still refuses anything landing
outside the workspace or a configured root, or the palette becomes an
arbitrary-file browser.

Backend only: `packages/host-service/src/trpc/router/filesystem/search-roots.ts`
plus a merge in `searchFiles`. **The renderer was not touched** — widening the
existing procedure meant `useV2FileSearch` and the palette needed no changes at
all. 10 unit tests; host-service holds at its documented 7-fail baseline.

## 1.17.46 — the blank terminal, second attempt. READ THIS FIRST.

**1.17.45 shipped the first blank-terminal fix and it did NOT work.** He tested
it and reported: a plain PowerShell pane is still blank, Claude Code full screen
is "just non existent", Codex is cropped. So `3cefb11d8` fixed only half the
cause. Do not treat that commit as the answer.

**The observation that cracked it, from him: dragging a pane into a split makes
the content render correctly.** That single fact rules out everything upstream.
Two probes had already cleared the host side, both measured, not reasoned:

- host-service hands a renderer-style WS client all 195 bytes of a PowerShell
  startup burst — clear-screen, title, OSC markers and `PS C:\Dev\SecondBrain> `.
  Reproduce with a `fetch` POST to `/terminal/sessions` then a `ws://` attach
  carrying `?token=<authToken>` from `~/.superset/host/<org>/manifest.json`.
  Auth is a **query param**, not a header — a browser WebSocket cannot set one.
- the pty-daemon replays correctly even when subscribed 300 ms AFTER open, so
  the open→subscribe gap loses nothing.

And replaying those bytes — plus his real 510-byte pane capture — through a real
xterm engine (`@xterm/headless` shares the parser and buffer) puts the prompt at
**viewport row 0 in every geometry combination**, including 120×32 later fitted
to the measured 158×43. Bytes fine, buffer fine, geometry fine.

### Root cause: xterm measures the cell ONCE and `fit()` is not a re-measure

xterm measures its character cell inside `open()` by laying out a probe glyph,
and never again unless a font *option* changes. Two things make that single
measurement wrong: `open()` before the element has layout (measures 0×0), and
`open()` before the configured font has loaded (measures a **fallback face**).

`3cefb11d8` fixed the first by parking the wrapper before `open()`. **The font
one survived**, and his evidence proves it: if the cell were 0×0,
`FitAddon.proposeDimensions()` bails outright and resizing could not help
either. Resizing DOES help, so the cell is non-zero but measured against the
wrong font.

Why it can never self-heal: `proposeDimensions()` reads the **cached**
dimensions (verified in the installed addon-fit — it returns early on a 0 cell).
No `resize()` means the renderer's `handleResize` never runs, and `handleResize`
is the only thing that rebuilds the drawing surface. `setRenderer` already does
a `_fullRefresh()`, so a refresh was happening all along — into a surface built
from bad numbers.

That is the whole symptom set, asymmetry included: a plain shell prints its
prompt once so nothing repaints it (blank); agents repaint constantly so they
show, but cropped to the wrong geometry and missing their one-time banner; a
real container resize rebuilds the surface and everything is correct.

**Fixed in `1b2d73ef8`:** `remeasureCharSize()` before every `fit()`. A changed
cell fires `onCharSizeChange`, which `RenderService` turns into the renderer's
`handleCharSizeChanged` → `_updateDimensions()` plus a width-cache clear (all
three links verified in the installed xterm 6.1.0-beta.220, not assumed). It
reaches `_core._charSizeService`, which is private — same justification the mode
tracker documents — wrapped in try/catch so a rename degrades to today's
behaviour instead of breaking the pane.

`font-settle.ts` has described this since April: mangled metrics "only repairs on
the next resize". There was already a hook firing on font load; it just called
`fit()`, which could not do anything. Now it re-measures first.

**Not seen working.** A Claude Code session inside GatedSpace dies with the app
(ancestry `claude.exe → cmd.exe → GatedSpace.exe`), so that session cannot close
the app to test itself. **Do not reach for dev mode as the way round this — he
tried it, it does not work, and he has asked that it stop being cited.** An
install is the only current proof, and finding a way to test with GatedSpace
left open is an open request (see Open items).
If a plain pane is STILL blank after 1.17.46, the next suspect
is the rAF in `_writeCoalescer` never firing for an *occluded* window
(`backgroundThrottling:false` does not restore rAF for occluded, only
backgrounded) — and do NOT go back to geometry or to byte delivery, both are
disproven above.

### The pty-daemon bump is load-bearing — 0.2.7

`602234746` fixed three things, and one of them lives in the DAEMON, which
survives app updates on purpose because the user's shells live in it:

- **`handleClose` threw on every Windows pane close.** node-pty's Windows
  backend rejects ANY explicit signal (`Signals not supported on windows.`) and
  `Pty.kill()` always passed one — reproduced live against the running daemon.
  So `disposeSession` reported failure, the DB row stayed `active` forever, and
  the shell was never killed. **358** of these in one log, which is where
  `port-scan sync: registered N unattached daemon session(s)` comes from.
- **`ws.close()` threw and left the socket half-open.** RFC 6455 caps a close
  reason at 123 BYTES; the workspace-mismatch message is 160 with real uuids.
  Reproduced live: the client gets `{type:"error"}` and then **no close event at
  all**. The renderer has already set `_terminated` (killing auto-reconnect) but
  never sees the close, so it sits in `"connecting"` behind a blank xterm,
  permanently. 18 in `host-service.log`, each immediately after a
  `respawning lost session`. Fixed with `truncateCloseReason` + a `closeSocket`
  helper that cannot throw.
- **The OSC 133 scanner only accepted BEL.** Live output terminates with ST
  (`\x1b]133;A\x1b\\` — confirmed in a real capture), so the scanner latched the
  prefix and swallowed the rest of the stream until the 3 s timeout. Windows
  dodged it because powershell isn't in `SHELLS_WITH_READY_MARKER`, **but every
  bash/zsh/fish terminal has this.** Now accepts ST and releases held bytes past
  a 512-byte cap.

**`EXPECTED_DAEMON_VERSION` derives from `pty-daemon/package.json#version`, so
0.2.7 marks the running 0.2.6 daemon `updatePending`. It does NOT auto-restart**
— `expected-version.ts` is explicit that sessions live in the daemon and the
user triggers the restart. So on install the renderer fixes apply immediately,
but **the leaked-shell fix does nothing until the daemon is restarted.** Without
the bump it would have been silently inert, which is the trap AGENTS.md rule 12
already cost us once.

**Still needs a smoke test — packaging changes cannot be proven by file lists,
and the file lists are all that has been checked.** Open a terminal, run an
agent, open the sidebar browser, render a mermaid diagram, and check the emoji
picker. Those five sit closest to what was excluded, and each has a specific
way it would fail: a stripped native binary kills the terminal or the browser
outright, while mermaid and the emoji picker would fail only if Vite had *not*
actually inlined what their `node_modules` copies used to provide.

## 1.17.46 — the blank terminal, take two. `3cefb11d8` SHIPPED AND WAS NOT ENOUGH.

**Do not read `3cefb11d8` as the fix. He ran 1.17.45 with it installed and
reported the pane still blank.** It fixed one of two causes. The second is
`1b2d73ef8`, and the evidence that identifies it came from him, not from
reading:

> full screen, the Claude pane is "just non existent" and Codex is cut off —
> but **splitting the panes smaller renders both correctly**.

That single observation is the whole diagnosis, and it also **rules out the two
theories this file previously carried**:

- Not delivery. host-service hands a renderer-style WebSocket client all 195
  bytes of a PowerShell startup burst, prompt included. Measured against the
  live host, not reasoned.
- Not geometry, and not reflow. Replaying those bytes *and* his real 510-byte
  pane capture through a real xterm engine (`@xterm/headless`, same parser and
  buffer) puts the prompt at **viewport row 0 in every combination** — born
  120×32 then fitted to the measured 158×43, born already at 158×43, real
  output into a mismatched terminal. Reflow never moves it out of view.

**Root cause: xterm measures its cell size EXACTLY ONCE, in `open()`, and
`fit()` is not a re-measure.** Two things make that one measurement wrong:
`open()` running before the element has layout (measures 0×0 — that was
`3cefb11d8`), and `open()` running before the configured font has loaded
(measures a fallback face — that is what was left).

It can never self-heal because `FitAddon.proposeDimensions()` reads the
**cached** dimensions and returns undefined on a 0×0 cell (verified in the
installed `addon-fit`). No `resize()` means the renderer's `handleResize` never
runs, and `handleResize` is the only thing that rebuilds the drawing surface.
`setRenderer` already does a `_fullRefresh`, so a refresh WAS happening all
along — it was painting into a surface built from bad numbers.

That explains every symptom including the asymmetry: a plain shell prints its
prompt once so nothing ever repaints it (blank); agents repaint continuously so
they show up but cropped to the wrong geometry and missing their one-time
banner; and a real container resize — dragging a split — is the one path that
rebuilds the surface, which is exactly what he found.

**His split-fixes-it evidence also proves the cell is non-zero but WRONG right
now.** If it were still 0×0, `fit()` would bail forever and resizing could not
help either. So after `3cefb11d8` the live failure is the font-timing case.

`1b2d73ef8` calls `_charSizeService.measure()` before every `fit()`. A changed
cell size fires `onCharSizeChange`, which `RenderService` turns into the
renderer's `handleCharSizeChanged` → `_updateDimensions()` plus a width-cache
clear (both verified in the installed xterm 6.1.0-beta.220). That is the
surface rebuild that was missing. `font-settle.ts` has described this since
April — "only repairs on the next resize" — and already had a hook that fired
when the font loaded; it just called `fit()`, which could not do anything.

Private-internals access, wrapped in try/catch, justified the same way the mode
tracker documents its own use of `_core`.

**`pty-daemon` went to 0.2.7 on purpose.** The Windows kill fix in `602234746`
lives in the daemon, and the daemon **survives app updates by design** — his
shells live in it. `EXPECTED_DAEMON_VERSION` is derived from
`pty-daemon/package.json#version`, so the bump marks the running 0.2.6 stale.
But read `expected-version.ts`: it explicitly does **NOT** auto-kill on
mismatch — "the user explicitly triggers restart". So installing 1.17.46 fixes
the blank pane (renderer-side) but **the leaked-shell fix stays inert until the
daemon is restarted.** Without that restart, `disposeSession daemon close
failed` keeps firing and shells keep leaking.

### What to check in 1.17.46, in this order

1. **A plain PowerShell pane, full screen, WITHOUT touching the split.** If it
   shows a prompt, this is done. This is the whole test.
2. Claude and Codex full screen show their banners, not cropped.
3. Then restart the pty-daemon and close a few panes. `host-service.log` should
   stop logging `disposeSession daemon close failed` (358 of them so far), and
   `port-scan sync: registered N unattached daemon session(s)` should stop
   climbing.

If a plain pane is STILL blank, do not re-fix geometry and do not re-fix
delivery — both are measured dead. The next suspects are the `rAF` in
`_writeCoalescer` never firing for an *occluded* window
(`backgroundThrottling:false` does not restore rAF for occluded, only
backgrounded), and the fact that `createRuntime` uses saved
`terminal-dims:<id>` while `useV2TerminalLauncher` hardcodes 120×32 — so
`8ecad06ce` never actually aligned the two ends for a reused id.

Also live: `detachFromContainer` persists the serialized buffer on every
unmount and `Tab.tsx` remounts panes on any layout change (no React `key`), so
a pane that is blank once persists blank and restores blank — a ratchet that
makes any paint bug look permanent.

### Two build traps this work hit, both likely to recur

**Defender locks `app.asar` and the failure looks unrelated.** A build died with
`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` from `app-builder.exe`; the real cause was
the previous build's 673 MB asar held by a virus-scanner handle that never
released. Every other file in the output dir deleted fine. Successful builds log
`output file is locked for writing (maybe by virus scanner) => waiting for
unlock...` and recover; that one did not. Escape hatch used:
`bun x electron-builder -c.directories.output=release-<something>` to package
into a fresh dir. Stale locked dirs can be deleted later once the handle drops.

**Do not pipe the build through `tail`.** `bun run build 2>&1 | tail -10`
reports the exit code of `tail`, which is always 0, so a failed build reads as a
success and the error scrolls out of the captured output. Run it unpiped.

    (Get-Item "$env:LOCALAPPDATA\Programs\GatedSpace\GatedSpace.exe").VersionInfo.ProductVersion

**The draft-release trap did not repeat, and now we know the fix works.**
`gh run watch` died again mid-ship with `wsarecv: An established connection was
aborted` — the exact failure that left 1.17.36 sitting as an unpublished draft.
The status-polling fallback added after that incident took over and published
correctly. Do not "simplify" that loop away; it has now earned its place twice.

## The install was 2,201 MB and 965 MB of it was unreadable on the machine

`38ed42a54`, 2026-08-09, at his request ("find bloat and make the app more
efficient"). **Packaging config only — no runtime code changed.** Every number
below was measured against the installed 1.17.42 by parsing the asar header and
walking `app.asar.unpacked`, not estimated. Re-measurable the same way.

- **639.2 MB of build and debug artifacts.** 436.8 MB of `.map` inside the asar
  alone, across **19,046 files**, plus `.pdb` and the MSVC scratch under
  `node-pty/build` (`.obj` 75.5 MB, `.iobj`, `.ipdb`, `.tlog`). Nothing in a
  packaged build can load a `.map`.
- **326.0 MB of binaries for platforms this build cannot execute.** onnxruntime
  shipped 140.6 MB of darwin + linux; koffi shipped **17 foreign platforms**
  including FreeBSD, OpenBSD, musl and riscv64; plus the wrong-arch duckdb
  binding, node-pty's macOS prebuilds, and x64 copies of `@libsql` and
  `@ast-grep`.

**Projected 2,201 MB → ~1,236 MB.** Not yet confirmed against a real installer —
it needs a build, and the figure comes from applying the exclusion globs to the
current install's file list.

**Do NOT set `sourcemap: false` in `electron.vite.config.ts` to "finish the
job".** Maps are still generated on purpose and excluded only at packaging time,
because `scripts/validate-native-runtime.ts:45` reads `dist/main/index.js.map`
to prove libsql and `@parcel/watcher` stayed external, and hard-fails the build
when it is missing. Sentry uploads the same files; dev mode reads them from
`dist/`.

**The one exception, and it has a test.** `agent-browser` publishes **no
win32-arm64 binary** — its x64 exe is the only Windows build in the package, and
ARM64 runs it under emulation. Pruning it as "wrong arch" leaves the browser
with nothing to launch. `runtime-dependencies.test.ts` pins this; if that test
ever looks wrong, check npm before changing it.

Excludes live in **two** places and both are needed: a `from`/`to` copy filters
against paths *inside* `from`, so the `**/node_modules/...` globs in the
top-level `files` array never reach `node-pty`, `@duckdb`, `@libsql` or
`@ast-grep`. Those carry their own relative excludes via `copyWholeModule`.

**Second pass, `5c7d233fb`.** Renderer duplicates (react-icons, mermaid,
emojibase-data, posthog-js — Vite already compiles them into `dist/renderer`,
and a bundled web app cannot require out of `node_modules`), the 54 unused
Electron locale `.pak` files, and node_modules residue (`.md`, `.ts` including
`.d.ts`, `test`/`example`/`.github` dirs). LICENSE, NOTICE and CHANGELOG stay —
some licences here require the text to ship, and a test pins that.

### Installer 503.1 MB → 302.4 MB, MEASURED — built and verified 2026-08-09

Not a projection. Three installers exist on disk and each was verified by
parsing the packaged asar, not by trusting its size:

    1.17.42   503.1 MB installer   2,534.7 MB installed   (baseline)
    1.17.43   319.9 MB
    1.17.44   318.3 MB                                    (node-pty x64 fixed)
    1.17.45   302.4 MB installer   1,318.9 MB installed   ALL CHECKS PASSED

**40% off the download, 48% off the install, with every feature intact.**

`runtime-dependencies.test.ts` plus the verification pass confirm: zero source
maps, zero renderer duplicates, one locale file (was 55), and js-tiktoken,
playwright-core, puppeteer-core, stagehand, the mermaid chunks, the emoji data
chunk and 1,226 LICENSE files all still present.

Remaining floor is ~85 MB of Electron runtime (Chromium; `GatedSpace.exe` is
190 MB raw, irreducible), ~25 MB of `superset.exe` (the bundled CLI, a real
feature), and the actual app. `claude.exe` is still 225 MB raw inside that and
remains the one big untouched item — his call, deliberately not done.

### Do NOT "clean up" these six packages

`js-tiktoken` (21.4 MB), `@browserbasehq/stagehand`, `playwright-core`,
`patchright-core`, `puppeteer-core` and `@linear/sdk` have **zero references in
either built bundle**, so a grep makes them look like ~60 MB of dead weight.
Five of them are not.

`mastracode` depends on `@mastra/stagehand` (→ stagehand → playwright /
patchright / puppeteer) and `@mastra/tavily` (→ `@tavily/core` → js-tiktoken),
and reaches them through **dynamic requires** — the same mechanism that already
forced `mastracode` itself into `mainExternalizedDependencies`. Cutting them
breaks the agent's browser and web-search tools at the moment of use, not at
startup, which is the worst possible failure shape. `runtime-dependencies.test.ts`
now pins all six as keep-list.

`@linear/sdk` is the one real maybe: `packages/trpc` imports `LinearClient` for
a cloud integration and the desktop build never references it. 13 MB, left in,
because the tRPC router resolves at runtime and that is not worth guessing at.

## The question sessions were REVERTED. Source is 1.17.40.

He ran the feature in 1.17.38, decided he did not want it, and asked for it out
on 2026-08-07. Done in `3dc68c6b4`. **Do not resurrect it, do not describe it as
a current feature, and do not reinstate the ACP pane.**

## 1.17.42 — notifications, sessions list, terminal geometry, the rail

**Building as of 2026-08-09, personal, at his request. NOT installed, NOT
shipped.** `9200805af` is the bump. Nine commits since 1.17.41, and none of it
has been seen running by anyone — say so rather than implying otherwise.

- `e834c8797` **notifications.** Sound never worked on Windows: `play-sound.ts`
  had branches for macOS (`afplay`) and Linux (`paplay`/`aplay`) and nothing
  else, so every call spawned a program that does not exist here and the ENOENT
  was swallowed by the fallback chain. That silenced the chime, the Settings
  preview button and every custom ringtone at once, which is why the whole
  section read as broken rather than unimplemented. Windows ships no
  command-line MP3 player and `SoundPlayer` is WAV-only, so it uses the Media
  Player COM object; the wait loop in that script is load-bearing, because
  playback is async and a script that returns immediately takes the sound with
  it. Also: **two independent systems were both drawing a banner** for one turn
  (main's hook server and the renderer's host-service bus), unable to see each
  other because they track shown notifications in separate maps under different
  key schemes — `banner-dedupe.ts` is one gate both pass through, keyed on the
  rendered WORDS because the two sides key ids differently. And `takePending`
  never took: it returned the notice and cleared nothing, so any later wake of
  the service worker re-alerted the phone with an event already announced.
  Phone push is now completion-only, which is what he asked for.
- `fa6089cda` **Recent Sessions rows.** Three hover buttons took roughly half
  the row width; only delete stays, resume and rename moved to right-click.
- `8ecad06ce` **terminal geometry.** `createSession` has accepted `cols`/`rows`
  all along and nothing passed them, so the pty spawned at host-service's
  default while the xterm was built at `DEFAULT_COLS`×`DEFAULT_ROWS`. The shell
  prints immediately at the pty's size and the client's real size only arrives
  when the socket reports `attached`, so everything printed in that gap reflowed
  to a geometry it was never laid out for. **This is the fix for the blank
  PowerShell pane, Codex's cropped welcome box and Claude's missing banner** —
  treated as one bug because it is one. The constants are exported rather than
  duplicated so the two ends cannot drift apart again.
- `e79890453` **resume in a real terminal**, via `openTerminalInWorkspace`
  (mirrors `openSessionInWorkspace` — the sidebar sits above the workspace
  routes and cannot reach a live pane store, but the layout is persisted).
  Session is created and AWAITED before the pane is written, or the pane's
  socket beats the session into existence and renders as a dead terminal.
- `cc4b9d0f8` **rename actually works.** The field used a bare inline ref
  callback calling `focus()` and `select()`; React re-creates and re-invokes an
  inline ref every render, so `select()` ran on every keystroke and each
  character replaced the whole value. Both reported symptoms — "glitches while
  typing" and "reverts after saving" — were that one bug.
- `a68620f66` **the rail.** It was `bg-sidebar`, the same colour as the panel,
  separated by a border at 45% opacity: about a 4% lightness step, invisible.
  There was no toolbar, just glyphs in the panel's margin. Now on
  `bg-background` with a full-strength divider, and the active icon takes the
  accent plus a layered glow. Previewed first —
  `plans/20260808-sidebar-rail-preview.html`, six treatments plus three glow
  strengths.
- `e2647f524` **sessions list readability**: project name on a second line, date
  group headers, and search that reads the transcripts (`searchContent`, bounded
  at 3 chars / 250ms / 200 files / 2 MB, scanning each file backwards and
  stopping at the first hit).
- `f1ee359d0` **the duplicate-sessions fix** — see below, it is the most
  surprising thing in this release.

### Every session existed three times, and delete only removed one

Measured, not inferred, on his machine 2026-08-09:

    total transcript files : 1293
    distinct session ids   :  429
    duplicated ids         :  429   <- every single one

One copy in `.claude`, one in `.claude-amitai`, one in `.claude-robbie`. The
list takes the newest 60 FILES, so ~20 real conversations were drawn as 60 rows.

**The existing de-dupe could never have caught it.** It resolves `realpath`,
which catches one file reached by two paths — the junctioned dirs it was written
for. These are genuine separate files per account. De-dupe is now keyed on
session id, resolved by mtime (the copy under the account last worked in is the
one still being appended to). Display only: resuming hands the id to the CLI,
which reads whichever config dir it is pointed at.

**The same fan-out made delete look broken.** It trashed one file of three, so
the session returned on the next refresh — indistinguishable from a silent
failure, and the reason his test sessions kept coming back. `findSessionFiles`
resolves every copy; `remove` trashes all of them. Codex has one file and no
fan-out, so it still deletes exactly what was listed.

If a future session sees this list looking "too short", that is correct.

### START HERE — the previous root cause was WRONG. Measured 2026-08-09.

**The `replay: false` theory in the last handoff is disproven. Do not spend
another round on it.** It was written from reading alone and it was wrong on
every count:

- `terminal.ts:104` is inside `makeDaemonPty.onData`, a helper for LAYERED
  observers. **Nothing in production calls `pty.onData`** — grep it; only
  `teardown.ts` uses `pty.onExit`. That line never runs on the pane path.
- The PRIMARY subscription (~line 1166) already passes
  `{ replay: replayOnAdoption }`, which **defaults to `true`**.
- The daemon buffers every session's output regardless of subscribers, so a
  late subscribe loses nothing.

All three were verified against the live machine, not reasoned about:

1. **Daemon replay works.** Spoke the daemon protocol directly, opened a
   PowerShell pty, waited 300 ms (wider than the real open→subscribe gap), then
   subscribed with `replay: true`. Got the whole startup burst back — `ESC[2J`,
   the title, and `PS C:\Dev\SecondBrain> `.
2. **host-service delivers it too.** `POST /terminal/sessions` then a
   WebSocket attach — exactly what the renderer does — returned all 195 bytes
   of the burst, prompt included, plus `attached` and `title` frames.
3. So **the bytes reach the renderer.** Whatever blanks a fresh pane is on the
   renderer side of that socket, and the host is exonerated.

To redo either probe: manifest at
`~/.superset/host/<org>/pty-daemon-manifest.json`, token at
`~/.superset/<pipe-basename>.token`, host-service endpoint + `authToken` in
`~/.superset/host/<org>/manifest.json`. The WS takes the token as
`?token=…` (a header won't work — the browser WebSocket API can't set one).

**What was actually broken, and is now fixed.** These are real, each proven
with evidence, but none is confirmed to be the fresh-pane blank:

- **`ws.close()` threw and left the socket half-open** — the one that really
  does strand a pane forever. RFC 6455 caps a close reason at 123 BYTES and
  `ws` enforces it by throwing; the workspace-mismatch error is 160 bytes with
  real uuids. Reproduced live: the client gets `{type:"error"}` and then **no
  close event at all**. The renderer has already set `_terminated` (killing
  auto-reconnect) but never sees the close, so it sits in `"connecting"`
  behind a blank xterm, permanently. 18 of these are in `host-service.log`,
  each one immediately after a `respawning lost session`. Fixed with
  `truncateCloseReason` + a `closeSocket` helper that cannot throw.
- **Every pane close leaked its shell.** node-pty's Windows backend throws
  `Signals not supported on windows.` for ANY explicit signal, and
  `Pty.kill()` always passed one. So `handleClose` returned an error instead
  of `closed`, host-service logged `disposeSession daemon close failed`
  (**358 times**), left the DB row `active` forever, and never killed the
  shell — which is where `port-scan sync: registered 8 unattached daemon
  session(s)` comes from. On win32 it now calls a bare `kill()`.
- **The OSC 133 scanner only accepted BEL.** Live output terminates with ST
  (`\x1b]133;A\x1b\\` — confirmed in the capture above). Taking only BEL meant
  the scanner latched onto the prefix and swallowed the entire rest of the
  stream until the 3 s timeout. Windows dodged it because powershell isn't in
  `SHELLS_WITH_READY_MARKER`, **but every bash/zsh/fish terminal has this.**
  Now accepts ST, and releases held bytes past a 512-byte cap.
- **Timed-out marker bytes went to the replay FIFO, not the socket**, so they
  only appeared on a later re-attach. Now broadcast-or-buffer like live output.
- **`shell.split("/")`** never split a Windows path, so the shell basename was
  the whole `C:\...\powershell.exe`. Splits on both separators now.

`bun test packages/host-service/src packages/pty-daemon/src packages/shared/src`
→ 1394 pass / **7 fail, the documented baseline**. Lint and typecheck clean
(`apps/electric-proxy` typecheck fails on this machine for missing Workers
types — pre-existing, unrelated, wrangler can't install on ARM64).

### The blank pane is a PAINT bug, and geometry had nothing to do with it

**Geometry is also disproven — stop looking there.** Replayed the captured
bytes, and his real 510-byte pane capture, through a real xterm engine
(`@xterm/headless` shares the parser and buffer with `@xterm/xterm`). In every
combination — born 120×32 then fitted to the measured 158×43, born already at
158×43, real output into a mismatched terminal — **the prompt lands at viewport
row 0 and is visible.** Reflow never moves it out of view. The bytes arrive and
the buffer is right, so the fault is in painting, not in data or size.

**Root cause, fixed in `3cefb11d8`: `createRuntime` called `terminal.open(wrapper)`
while `wrapper` was in no document.** xterm measures its cell size during
`open()` by laying out a probe glyph; an element with no layout measures 0×0 and
then *stays* 0×0, because nothing re-measures until a font option changes. One
cause, two silent failures:

- `FitAddon.proposeDimensions()` bails on a zero cell size, so the first `fit()`
  is a no-op and the terminal keeps its birth geometry.
- The WebGL addon attaches a frame later and builds its drawing surface from
  those same zero dimensions.

**That is exactly the asymmetry he reported.** Agents repaint continuously and
recover on the first re-measure (font settle, DPR change, the repaint watchdog),
which is why Claude and Codex came up merely cropped. A plain shell prints its
prompt once and has nothing left to redraw it with, so it stays blank for good.
Note `terminal-addons.ts` already carries a repaint watchdog whose comment says
"a healthy session can sit behind a blank or blurry pane indefinitely" — the
codebase half-knew.

The fix uses machinery already in the file: park the wrapper *before* `open()`.
The parking container is deliberately `100vw × 100vh` at `-9999px` — attached
and measurable, never visible — and its own comment says it exists to keep xterm
attached to the document. `createRuntime` simply wasn't using it at birth.

**This is reasoned from xterm's measurement path, not observed running.** Dev
mode can't start while the installed app is open, and a Claude Code session
inside GatedSpace dies with the app (ancestry is `claude.exe → cmd.exe →
GatedSpace.exe`), so it cannot close the app to test itself. **Needs a build.**
If a plain pane is still blank after it, the next suspects are the rAF in
`_writeCoalescer` never firing for an occluded window (`backgroundThrottling:false`
does not restore rAF for *occluded*, only backgrounded), and the fact that
`createRuntime` uses saved `terminal-dims:<id>` while `useV2TerminalLauncher`
hardcodes 120×32 — so `8ecad06ce` never actually aligned the two ends for a
reused id.

Also live: `detachFromContainer` persists the serialized buffer on every
unmount and `Tab.tsx` remounts panes on any layout change (no React `key`), so
a pane that is blank once persists blank and restores blank — a ratchet that
makes any paint bug look permanent.

### Test baselines — the old numbers in this file were stale

Measured 2026-08-09, and the desktop figure was measured twice, with and
without the renderer diff, byte-identical both times:

- `bun test apps/desktop` → **2337 pass / 62 fail / 6 skip / 10 errors**, 2405
  tests. The "37 fail out of 2628" further down predates several commits; the
  suite is smaller now and the failure count is higher. 62 is the baseline.
- `bun test packages/host-service/src packages/pty-daemon/src packages/shared/src`
  → **1394 pass / 7 fail**. The 7 are the documented Windows path assumptions.
- `bun run typecheck` fails ONLY in `apps/electric-proxy`, for missing
  Cloudflare Workers types — pre-existing and environmental (wrangler will not
  install on ARM64). Every other package is clean. Don't chase it.

### What to check once 1.17.42 is installed

Nothing below has been seen working. An install is the only proof.

1. **A terminal opens and shows something.** This is the big one. Plain
   PowerShell was coming up blank, Codex cropped, Claude with no banner. If a
   plain shell is STILL blank after this, that is a second fault stacked on the
   geometry one and it needs its own investigation — do not re-fix the geometry.
2. **Right-click a recent session → Resume in terminal** opens a terminal and
   runs the command.
3. **Renaming works** — type a full name, it survives, and it is still there
   after the list refetches.
4. **Delete removes the session for good.** It used to come back; if it still
   does, `findSessionFiles` is not seeing every root.
5. **The list is much shorter and each row shows a project.** ~20 conversations
   where there were 60 rows. Date headers, and each row two lines.
6. **Search finds a phrase from inside a conversation**, not just a title.
   Three characters minimum before it runs.
7. **Notification sound plays** — Settings preview button first, since that was
   silent on Windows for the same reason the chime was.
8. **One notification per finished turn, not two.** And the phone gets one, on
   completion only.
9. **The rail reads as a toolbar**, with the active icon lit. If the double
   orange (rail plus focused Claude pane) is noisy, it is the two drop-shadow
   numbers in `DashboardSidebarRail.tsx`, nothing structural.

---

**1.17.40 shipped publicly. 1.17.41 personal was BUILT, INSTALLED, and he
reported it working on 2026-08-08** ("1.17.41 is done and good"). Treat its
checklist further down as mostly satisfied — with one exception called out
there: the draft-loss trigger was never reproduced, so "good" is not evidence
that specific fix works. Ask him to try it deliberately before closing it out.

    apps/desktop/release/GatedSpace-personal-1.17.41-arm64.exe   503 MB
    SHA256 BF1CC229016E853187D5278328150681474F1D5B82B7E59A8B71FA9222B2B313

Verified against the built bundle rather than the source: the phone client in
`dist/main/index.js` has zero occurrences of `id="mic"`, `SpeechRecognition` and
`stopMic`, and one of the arrow send button; the renderer has no `accept="image/*"`
left. (The phone picker's own `accept="image/*"` still lives in the MAIN bundle
and is deliberate — see the mobile-bridge section.)

Verified against the built artifact, not just the source: the **renderer bundle
is completely clean** of `acp-session` / `acpSessions` / `AcpSessionPane`, and
the ring's overlay class is present in it. `acp-sessions` still appears in
`dist/main/host-service.js`, which is the dormant runtime described below and is
expected.

**SHIPPED PUBLICLY on 2026-08-08**, after he installed and tested the personal
build. Headline: *Active pane highlight, and no more freeze when you switch
back*. Remember the public build is NOT the same app as his: CI bakes
`NEXT_PUBLIC_LOCAL_ONLY=1` and he runs the personal build, so his testing
validated the code, not the public artifact itself.

Method matters here and he chose it: **reverted forward on `windows-port`, not
rebuilt from the 1.17.36 rollback.** His reasoning — a revert can only remove
what the question commits added, whereas replaying onto 1.17.36 could silently
drop something else. Correct instinct.

The proof it landed cleanly: **the entire diff between the tree and the 1.17.36
commit `dbb82eec8` is 14 files, and not one is question related.** Re-run it if
you doubt anything:

    git diff dbb82eec8 --stat -- apps packages

What that diff contains is only: three version bumps, three plan/preview docs,
`resume-claim.ts`, `session-manager.ts`, `main/windows/main.ts`, `Pane.tsx`,
and `packages/shared/src/session-lock.ts`.

**The question work is tagged, not destroyed** — `acp-question-sessions` points
at `2a997e3ac`. Everything is recoverable from there.

**What deliberately REMAINS, and why it is not a leftover.** The ACP runtime in
`packages/host-service` (`runtime/acp-sessions/`, its tRPC router, its tests,
and `packages/host-client/src/acp/`) is untouched and byte-identical to
1.17.36. It predates this work, was built for a phone client that does not
exist in this checkout, and is dormant with no client. It still contains the
`elicitation: { form: {} }` capability and `parkQuestionCard`. Removing it means
dropping `@agentclientprotocol/claude-agent-acp`, which is the **225 MB job he
has explicitly deferred** — see below. Until he asks, leave it alone.

`apps/desktop/release/` holds `GatedSpace-personal-1.17.36-arm64.exe` and the
`CardPersonal` builds .37, .38 and .39 (~503 MB each). **All three CardPersonal
builds contain the question feature and are now superseded**; .37 is also
broken. The `CardPersonal` name was reverted with the feature, so 1.17.40
onwards is `GatedSpace-personal-<version>-<arch>.exe` again.

### The 225 MB, since it will come up

`resources\app.asar.unpacked\...\claude-agent-sdk-win32-arm64\claude.exe` is
**225 MB of a 2,535 MB install**. Nothing in this repo declares that package; it
arrives purely as a transitive dependency of `@agentclientprotocol/claude-agent-acp`.

**It was already there in 1.17.36** — the adapter is declared in both
`apps/desktop/package.json` and `packages/host-service/package.json` at
`dbb82eec8`. So the question feature did not introduce it and reverting does not
shed it. He knows, and has ruled it a separate job. Also found while measuring,
also not started: ~140 MB of other-platform binaries ship on this ARM64 build
(`onnxruntime` for darwin-x64/arm64 and linux-x64, plus a **win32-x64** duckdb
beside the arm64 one), `app.asar` is 1.2 GB, and `%APPDATA%\GatedSpace\network-logs`
was 405 MB with no cap.

Two throwaway output folders, `release-1138` (2.0 GB) and `release-133` (3.0 GB),
were deleted on 2026-08-07 once their locks cleared. They came from the
`--config.directories.output` escape hatch — see the trap about it below, and
prefer waiting out a lock over creating another one.

**Rollback point: `C:\Dev\_gatedspace-rollback\`** (2026-08-05, before the ACP
work). Holds the 1.17.36 *personal* installer with its SHA256, all 424 session
transcripts, `%APPDATA%\GatedSpace`, and `~/.superset` minus worktrees. Restore
steps in its `ROLLBACK.md`. **Do not delete it to reclaim disk.** Note the
public release is NOT a rollback for the maintainer's app: CI bakes
`NEXT_PUBLIC_LOCAL_ONLY=1` into public builds and his is the personal one.

## 1.17.41 — nine UI fixes plus the phone composer

All committed on `windows-port`, none seen running by a human. Commits
`24b552c48`, `b3177d0fe`, `ddfc29e8d`, `cdaf996df`, `ce9fc79dc`.

**The session-header overlap had a root cause, not a crowding problem.** The
account strip was `absolute inset-x-0` with `justify-center`. Out of flow means
nothing reserves room for it and nothing pushes it aside, so it printed over the
folder name and the context count the moment the header ran short — at ANY pane
width, not just with four panes. It is in the layout flow now with `min-w-0`.
Hiding items would have hidden the symptom and left it waiting at two panes.

- **Compact header** above one pane: account label and both meters stay, reset
  times / cost / MCP count drop. He asked for the account explicitly — three
  accounts are in rotation and "whose limit is this" is the question.
- **Context colour is absolute**: yellow 400k, red 750k. The old 70/90 percent
  thresholds meant a 1M-window model warned at 700k, past the point of acting.
- **Rail centred**, Testing removed, persisted panel version bumped to 3.
- **Pencil in the pane header.** Renaming always worked on double-click, which
  is invisible, which is the same as not having it.
- **Recent Sessions rename + delete.** See below, it is the interesting one.
- **Desktop composer takes any file.** `accept="image/*"` meant a PDF was not
  even listed. Images still go as base64 blocks; everything else goes as an
  absolute path via `window.webUtils.getPathForFile` and the agent reads it off
  disk. Deliberately NOT `document` blocks — the CLI's stream-json input is not
  known to accept them, and one that gets silently dropped is indistinguishable
  from the model ignoring the file.

### Renaming a pane never persisted, and that was the real bug

A pane rename writes `titleOverride` on the PANE, which dies with it. Close the
pane, reopen the session from Recent Sessions, and the model's generated title is
back. He had been renaming every pane individually as a workaround for something
that never stuck.

Names now live per SESSION in `~/.superset/session-titles.json`, keyed by session
id, applied in `listClaudeSessions`. **Applied there and not in `summarizeFile`
on purpose**: the summary cache is keyed on the transcript's mtime, and renaming
does not touch the transcript, so a rename would not appear until the session
next wrote to disk.

**Never write names into the transcript.** That file is the CLI's, it is
append-only JSONL the CLI re-reads, and this repo has already lost transcripts to
two writers. The sidecar is written temp-file-then-rename so a crash leaves the
old file rather than a truncated one that reads as "no names at all".

**Delete uses `shell.trashItem`, never `unlink`,** and takes two clicks. A
transcript is the only copy of a conversation. The path is re-derived in main
from the session id rather than accepted from the renderer — a path parameter
straight into a delete is an arbitrary-file-delete primitive.

### The draft-loss bug: class fixed, trigger NOT reproduced

Reported as: type a prompt, do not send, move a tab into a split or collapse to
one pane, text gone.

The draft store is fine — module-scoped, keyed by pane id, written per keystroke,
re-seeded on mount, built to survive unmounting. The only thing that destroys a
draft is `disposeSession`, wired to `onAfterClose`. **And nothing calls
`onAfterClose`** — `Workspace.tsx` INFERS it by diffing pane ids frame to frame.
A move and a close are indistinguishable to a diff, and the penalty is the user's
typed text.

It now defers a tick and re-checks the LIVE store, so a pane absent for a tick
and back is treated as moved. **Honest limit: I could not reproduce his exact
sequence by reading.** Both `movePaneToSplit` and `moveTabToSplit` preserve pane
ids inside a single `set()`. Needs confirming in a real build.

Related and unfixed, worth its own job: **`Tab.tsx` renders panes with no React
`key`** inside a recursive layout tree, so splitting or unsplitting changes a
pane's depth and forces an unmount and remount of every affected pane. That costs
component state in every pane on every layout change.

### The phone app is `mobile-bridge`, NOT `apps/web` and NOT the desktop composer

Cost a wrong answer on 2026-08-08: he said "the prompt bar has a mic", I searched
the desktop renderer, found none, and told him his premise was wrong. He meant
the phone. **The phone UI is a hand-written app in
`apps/desktop/src/main/lib/mobile-bridge/` — `client-html.ts` + `client-css.ts` +
`client-app.ts`, served over Tailscale.** There is no `apps/mobile`.

Mic removed, Send shrunk to a 42px arrow. The composer is one row and buttons
cost prompt width. The mic was near-dead already: the browser speech API needs a
secure context and the DEFAULT bridge link is plain HTTP, so it usually hid
itself and pointed at the keyboard's dictation key.

**`client-app.ts` is one big template literal.** A backtick in a comment ends the
string; that cost a build here. Same for `${`.

**The phone picker stays image-only**, unlike the desktop. The bridge sends
base64 image blocks and a phone has no filesystem path to offer instead, so a PDF
would fail after picking rather than at the picker. Opening it up needs an upload
endpoint on the bridge. Not started.

### 1.17.41 checklist — INSTALLED 2026-08-08, he reported it good

**Item 3 (the draft surviving a layout change) is the one still genuinely open.**
It was fixed without ever reproducing the trigger, and it is not the kind of
thing a user notices working — you only notice it failing. Everything else here
is visible on sight and he has been looking at the app, so treat those as
confirmed. The original wording follows.

Nothing in 1.17.41 has been seen working by a human. Say so rather than implying
otherwise. An install is the only proof.

1. **The session header no longer overlaps itself** at two, three and four panes,
   and the compact set is right (account + both meters + context, nothing else).
2. **Context goes yellow past 400k and red past 750k.**
3. **The prompt survives a layout change** — type without sending, move a tab
   into a split, then collapse back to one pane. This is the one that was fixed
   blind; if it still loses text, that is new information and the diff in
   `Workspace.tsx` is not the whole story.
4. **Rename in Recent Sessions sticks** across closing the pane, reopening the
   session, and restarting the app. That is the whole point of it.
5. **Delete sends the transcript to the Recycle Bin** and takes two clicks.
6. **The pencil renames each pane** independently with several panes open.
7. **The rail icons are centred** and Testing is gone. If the panel comes up
   blank on first launch, that is the persisted-panel migration and the version
   bump did not take.
8. **A PDF attaches in the desktop composer** and the agent can actually read it.
9. **On the phone** (reload the page after installing): no mic, Send is an arrow,
   more room to type.
10. **The interface-scale sliders at 80%** — still outstanding from 1.17.35.

He has **no saved question panes**, so the unknown-pane-kind hazard does not
apply to him. Checked 2026-08-07 by reading `~/.superset/tanstack-db.sqlite`,
its `-wal`, `local.db`, `window-state.json` and `app-state.json` with shared
access: the string `acp-session` appears zero times. (Read those with
`FileShare::ReadWrite` and **confirm a non-zero byte count** — a locked-file read
that fails silently returns zero hits and looks exactly like a clean store.)
It would matter for anyone else: saved layouts persist a pane's `kind`, nothing
prunes unknown kinds, and `Pane.tsx` renders `Unknown pane kind: acp-session`.

## REVERTED — AskUserQuestion in the desktop session pane

**This feature is gone as of `3dc68c6b4`. The section below is kept as a record
of what was measured, not as a description of the app.** Tag
`acp-question-sessions` (`2a997e3ac`) has the working code if it is ever wanted
again. Nothing here should be read as "GatedSpace does this".

Goal was: the question card Claude Code shows in the terminal, in the desktop
session pane. Built 2026-08-05 to 08-07 at his request, shipped in 1.17.38,
removed at his request on 08-07. **Facts below were measured, not reasoned — if
this is ever revisited, do not re-derive them.**

- **It is unreachable on the current transport.** Probing the live CLI
  (2.1.220) with the pane's exact args — `--print --input-format stream-json
  --output-format stream-json --include-partial-messages --verbose` — returns
  32 built-in tools and `AskUserQuestion` is not among them. The CLI withholds
  it from clients that cannot declare form-elicitation capability, and raw
  stream-json has no handshake in which to declare one. No renderer work gets
  you there; the transport has to change.
- **The ACP path does deliver it.** Adapter `claude-agent-acp` 0.56.0, already
  a dependency of `apps/desktop`. `acp-sessions.ts:747` declares
  `elicitation: { form: {} }`, which is what re-enables the tool.
- **It works on Windows ARM64**, contrary to the docs implying a Mac-only lane.
  Measured 2026-08-05 on the maintainer's Snapdragon X Elite: deterministic ACP
  lane 19/19; real-Claude lane `ACP_E2E=1 ACP_E2E_MODEL=sonnet` 10/10 including
  `test("AskUserQuestion parks a real adapter elicitation and resumes after the
  answer")`. The Workflow test ran 5 live Sonnet agents, 122k tokens.
- **ACP and the panes share ONE transcript store.** Snapshotted
  `~/.claude/projects`, ran the ACP e2e, found 9 new transcripts in it. This is
  the whole reason the guard work below is mandatory rather than tidy.
- **There is no ACP client UI in this repo.** `apps/mobile` does not exist here
  and nothing consumes `useAcpSession` / `useAcpPermissions`. The host side is
  built and tested; the screen is greenfield. Docs referencing a mobile
  "Live sessions" entry point describe something not in this checkout.

Done, both green against the 52-fail baseline with lint and typecheck clean:

- `cfca88da4` — `resolveResumeClaim` accepts `externallyHeld` and reports
  `blockedByExternal` separately, so the message can avoid saying "pane" about
  a holder with no tab to close.
- `2704e736e` — `session-lock.ts`: the claim is now a FILE under
  `SUPERSET_HOME_DIR/session-locks`, taken with an atomic `wx` create.

**Why a file and not an RPC** — do not "simplify" this back. `start()` is
synchronous, so querying the host service means caching on a timer, and a
stale or unpopulated cache reads as "nobody holds this". The guard would fail
OPEN in exactly the case it exists for: the same shape as the pinned-prompt
clamp that could never fire, except this one costs a transcript. The file
fails closed on contention and open on infrastructure trouble, steals locks
whose holder is dead, and is re-entrant per pid.

- `f36bac743` — the ACP runtime now takes the SAME claim. `session-lock` moved
  to `@superset/shared`; ACP claims before writing, refuses a `session/load` it
  cannot claim, and releases in `markDead`, `dispose` and the setup catch.
  `listHeldSessionIds` reads the lock directory, so the recent-sessions list
  sees live ACP sessions with no new endpoint.

**The id being locked was verified, not assumed** — the real adapter's
`session/new` returned `ee9c98e3-ea0a-4572-aaa7-d55d56da3307` and Claude wrote
that exact filename into `~/.claude/projects`. `acpSessionId` IS the
transcript's id. Locking the wrong one would have protected nothing while
looking correct.

**The guard is now two-sided and done.** Verified on Windows ARM64:
deterministic ACP lane 20/20, real-Claude e2e 10/10 in 108s, desktop suite at
its 52-fail baseline, shared lock units 19/19, typecheck and lint clean.

Step 3 in progress: a minimal ADDITIVE desktop ACP pane (timeline + question
card) behind `isInternalBuild()`, consuming `useAcpSession` /
`useAcpPermissions`. The stream-json pane stays untouched throughout. Do not
replace it — the parity gaps listed above are all still true.

- `bf6c80bb3` — card design **previewed and approved**
  (`plans/20260805-question-card-preview.html`, colours verbatim from
  `globals.css`), and its selection rules landed as a React-free tested module
  (14 tests). Questions arrive ONE AT A TIME (`parkElicitation`), so the
  terminal's question tabs are not needed. Encoding was already solved:
  `makeSelectedOutcome` puts extra picks on ACP's `_meta`.

**1.17.37 was the build that found the rough edges, exactly as expected — and
it found a real one.** Every ACP session in the packaged app died instantly
with `This session could not start. Internal error`. Two separate faults:

- **The error was invisible from both ends** (`f4fd9d7a7`). A throw with no
  message renders through tRPC as the literal string "Internal error", and
  nothing was logged host-side. Fixed first, on purpose: a bug you cannot see
  is not a bug you can chase.
- **`claude.exe` resolved to a path inside `app.asar`** (`e1874a63a`). Files in
  an asar are *readable* — Electron patches `fs` — but can never be *executed*;
  there is no real file at that path for `CreateProcess` to open. The adapter's
  own error blamed a **libc mismatch**, which on Windows is a pure red herring:
  do not chase it. `unpackedClaudeExecutable()` in `acp-sessions.ts` now
  rewrites `app.asar\` to `app.asar.unpacked\` and checks the file exists,
  returning null (i.e. keep the original) when it does not.
  **The unpacked file really is there** — verified 2026-08-07 against the
  installed 1.17.38, not assumed from config: electron-builder's smart unpack
  pulls the whole package out because it contains an `.exe`, and there is no
  explicit `asarUnpack` glob for it in `electron-builder.ts`. If that smart-unpack
  behaviour ever changes, this breaks silently and the fallback returns the
  packed path again. The file to look for is
  `resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-arm64\claude.exe`
  (225 MB).

Still true after those fixes: **the pane has never been run by a human.**
1.17.39 is built and not installed, so nothing below has been exercised
interactively — the evidence is the automated ACP lanes, not use.

- Pane kind `"acp-session"` in the registry; open one via the pane context
  menu → **Split with Questions Session**. That item is gated on the
  `acpSessions.list` capability probe (`enabled`), which is the designed
  mechanism and keeps it off public builds without the renderer knowing about
  build channels.
- The pane mints its own session id so a restored layout reattaches (`create`
  is idempotent per id+workspace), then forces `bypassPermissions`.
- Versions bumped across desktop + host-service + cli together (now
  **1.17.39**), the same three `ship` keeps in sync — bumping only desktop
  would leave a skew that a later ship silently inherits, because `ship` skips
  ALL bumping when desktop already sits at the target.
- **Never rebuild a version number that already has an artifact on disk.**
  1.17.38 was built, then the ring landed; rebuilding as .38 would have left
  two different binaries claiming one version, which is precisely what makes
  "the fix did not take" undiagnosable. Bump instead — that is why .38 exists
  and was never installed.
- Installer artifact is now `GatedSpace-CardPersonal-<version>-<arch>.exe`
  (`electron-builder.ts`). CI never sets `GATEDSPACE_PERSONAL`, so public
  artifact names are unchanged.

Build it with the personal flags, and **ask before starting one**:

    cd apps/desktop
    GATEDSPACE_PERSONAL=1 bun run prebuild
    GATEDSPACE_PERSONAL=1 bun run build

**When wiring the pane, set `bypassPermissions` after create.** The ACP runtime
forces sessions out of bypass (`acp-sessions.ts`) — correct for the phone,
wrong here. The maintainer runs bypass deliberately and said on 2026-08-05 he
has not accepted a permission in a month; an ACP pane that prompts him would be
a straight regression. Set it on the pane, do not change the shared rule.

Decisions still open, flagged to the maintainer, not acted on:

- **ACP forces sessions out of `bypassPermissions`** (`acp-sessions.ts:778`)
  while the pane defaults *to* it (`sessionStore.ts:73`) — a decision the
  maintainer made deliberately and this file says not to re-litigate. Moving a
  pane onto ACP silently reverses it.
- ACP history is a 5,000-frame ring with **no way to fetch older frames**; the
  pane reads full history from disk today. Replacing the pane would regress it.
- ACP sessions live in host-service, so a host crash kills an in-flight turn.
  The pane spawns from the main process today and is immune to that.

## What survived the revert, and why — the two he actually wanted

These are in 1.17.40. Neither is part of the question feature, and the revert
was scoped to leave them alone.

**The ~2s freeze on every switch back to the window** (`1981fd9f2`). Chromium
throttles a backgrounded renderer hard — `requestAnimationFrame` stops outright,
timers clamp to ~1/s. Nothing is dropped, only deferred, so returning runs the
whole backlog at once: every throttled `refetchInterval`, the React work behind
them, the terminal repaint watchdog, and every react-query window-focus refetch
(the QueryClient sets no `refetchOnWindowFocus` default, so react-query's own
`true` applies app-wide). That the stall was the same length however brief the
trip away is what fits a backlog, not a wake-up.

`backgroundThrottling: false` in `main/windows/main.ts` removes the backlog
instead of making it cheaper. The trade — real renderer cost while backgrounded
— is the right one here: terminals, agent sessions and file watchers are all
live behind another window anyway. **If a stall survives this, the next suspect
is that missing `refetchOnWindowFocus` default.** It was left alone on purpose;
flipping it app-wide trades a measurable freeze for silent staleness everywhere.

**The active-pane ring** (`45ff7c89a`), asked for on 2026-08-07: a highlight
around the focused pane, coloured per agent.

- **A ring already existed and had never once been visible** — in any version,
  to anyone. `ring-2 ring-highlight ring-inset` on the pane container renders as
  an *inset* box-shadow, which paints above that element's own background but
  BELOW its descendants; every pane body carries its own `bg-background` and the
  header carries the accent fill, so it was covered on all four edges. Same
  family of bug as the pinned-prompt clamp that could never fire. **Do not
  assume a class that looks right is rendering.**
- It is an overlay now: rendered after `<PaneContent>`, `absolute inset-0 z-30
  pointer-events-none`, so it frames what it sits over and cannot eat a click.
- Colour comes from the pane definition's `getAccent` — the same value the
  header fills with — not the hardcoded `--highlight`. Those were two different
  oranges (`#e07850` vs Claude's `#d97757`), a near-miss that reads as a
  rendering fault. A terminal with no agent still falls back to `--highlight`.
- **Both shadows are inset deliberately.** The approved preview had an outer
  bloom; the container's `overflow-hidden` and the resizable panel around it
  would have clipped it, so it would have silently degraded to a flat 2px ring.
  The soft band is drawn just inside the solid edge instead. The maintainer was
  told this differs from what he approved.
- Shows whenever the pane is active, **including when it is the only one** — he
  asked for that explicitly. The old `paneCount > 1` gate made the frame appear
  and vanish with pane count.
- Preview: `plans/20260807-active-pane-ring-preview.html`, with an "As shipped"
  section matching the built CSS.

**The transcript lock also survived** (`cfca88da4`, `2704e736e`, and the
non-ACP half of `f36bac743`). It came out of the question work, so the obvious
move was to revert it with everything else. **Don't.** The transcript loss it
guards against — 7/18 and again 7/19 — was pane against pane and had nothing to
do with ACP. The old guard only knew about writers inside one process, so a
second GatedSpace, or a crashed one still holding a claim, was invisible to it.

`session-lock.ts` stays in `@superset/shared` rather than being moved back to
`apps/desktop`. `session-manager.ts` imports it from there and
`listHeldSessionIds` is still live (`session-manager.ts:494`), so undoing the
move would be churn with a regression risk and no gain. Its ACP-side caller is
gone; the shared module itself is fully used.

## Most recent work: two UI passes (1.17.35, 1.17.36)

`af50e41dc` — five changes to the session pane, every one previewed against the
real theme before a line was written. The preview lives at
`apps/desktop/plans/20260803-ui-density-preview.html`; open it before changing
this area again.

Two of the five rested on assumptions the preview proved wrong:

- **The missing fade on Edit/Write was deliberate, not a bug.** Bash bodies sit
  on the page background so `from-background` works. A diff paints its own
  surface from the editor theme, so that same class blends to the wrong colour.
  `Clamped` now takes `fadeColor` — a resolved colour, not a Tailwind class —
  and `DiffPanel` passes what `SessionDiff` actually paints itself with.
- **The existing zoom could not be reused for per-region scale.**
  `webContents.setZoomLevel` scales the whole window including the sidebar,
  which is precisely what the request needed it not to do. The new
  `renderer/stores/ui-scale` uses CSS `zoom`, applied to the top bar, the
  outlet and the sidebar SEPARATELY — the sidebar renders inside the main
  column in some layouts, so zooming a shared ancestor would multiply the two
  scales together.

Also: tool rows lost ~22% height (three separate gaps, no type-size change),
the pinned prompt clamps at three lines with a chevron, and composer
attachments are row-height chips instead of 96px tiles.

**Preview before coding ANY visual change here.** The technique is a
self-contained HTML file under `apps/desktop/plans/` built from the real values
in `globals.css`, which is also how you see a change without an install. This is
a standing request from the maintainer — he asked for
it to keep happening — not a nicety.

### Then 1.17.36 — the fixes 1.17.35 needed, plus the composer

`27fe37485`, `6f7b2a92d`, `dbb82eec8`. Installed and confirmed working.

- **The pinned prompt's clamp had never once fired, in any version.** It was a
  deadlock: `maxHeight` was applied only when `overflowing` was true, but
  `overflowing` is measured as `scrollHeight > clientHeight`, and with no
  maxHeight the div renders at natural height so those are equal. The
  measurement could only observe overflow the clamp itself caused. Keyed off
  `expanded` alone now — which is what the tool-body `Clamped` always did, and
  why tool bodies worked while the prompt above them never did.
- **The sidebar crop in 1.17.35 was self-inflicted**: a wrapper div added to
  carry the zoom put a second flex box between the resizable panel and a child
  whose root is already `flex h-full`. The zoom goes on the sidebar's own root
  via a `style` prop now — no extra element at 100%.
- Expand toggle moved inside tool panels, revealed on hover.
- Composer: a real border at rest (it was `border-transparent`, which is why it
  read flat — not the shadow), full-strength divider, 35px utility bar down
  from 46px, and a grouped slash menu (Context / Model / Skills) with live
  state on the right. Nothing new is wired under the menu; every row drives a
  control the utility bar already had.

**Still unverified:** the interface-scale sliders at anything other than 100%.
The maintainer reported sidebar icons cropping at 80% main scale in 1.17.35;
removing the wrapper is the likely fix but has not been confirmed at 80%.

## Where things stand

**1.17.33 was broken and must not be shipped or installed.** It launched to a
window that loaded and then did nothing at all. `import { safeStorage } from
"electron"`, added to `crypto-storage.ts` by the DPAPI commit b15435e67, is
reachable from the host-service bundle — and the host service runs under
`ELECTRON_RUN_AS_NODE=1`, where requiring electron throws MODULE_NOT_FOUND. It
died at module load with exit code 1 on every launch, before running a line of
its own code, so everything behind the UI was dead while the window looked fine.

Fixed in **1.17.34** (`53a369a1e`): safeStorage resolves lazily inside a
function, so the main process still gets DPAPI and the child still loads. The
security property of b15435e67 is unchanged.

**A second 1.17.33 break, found while verifying the first** (`eecf5e74f`):
c3c2c204a closed `INVOKE_CHANNELS` completely, on the reasoning that the app
registers no ipcMain handlers — "verified by grep". The app's one handler is
registered *inside a dependency*: `exposeElectronSQLitePersistence` claims
`tanstack-db:sqlite-persistence`, and the renderer drives it through
`window.ipcRenderer.invoke`. Both sides take the package's default channel
name, so it appears as a literal nowhere in app code and the grep missed it.
Every TanStack DB collection read and write threw in the preload. The channel
is now allowlisted for invoke only, with a test pinning it.

Both bugs are the same mistake: **a grep over `apps/desktop` is not proof that
something is unused — dependencies register handlers and pull imports too.**

**The lesson generalises — read it before touching any shared module.** A
static import of electron *anywhere* a child entrypoint can reach is fatal and
silent: rollup hoists the external dep into every chunk that reaches it (one
import became a top-level `require("electron")` in six chunks). The five
entrypoints that run as plain Node are `host-service`, `terminal-host`,
`pty-daemon`, `pty-subprocess`, `git-task-worker`. Import electron lazily
inside a function, as `git-task-runner.ts` and `native-permissions.ts` do.
`validate-native-runtime` now fails the build on this and names the chunk, so
the trap is caught at build time rather than at the user's launch.

The security pass itself — fourteen commits — is complete and verified.

    eecf5e74f  fix: the IPC allowlist closed the collections persistence channel
    4f787eaf8  bump 1.17.34
    53a369a1e  fix: the DPAPI import killed the host service on every launch
    e8ee0661e  bump 1.17.33 (broken — do not install)
    32a231093  bridge revocation — "Unpair devices"
    c2bb13eb5  bridge: no pre-auth body parsing, header-only token, push allowlist
    66cee8887  the SHIPPED daemon entry was still unauthenticated
    944dc8eae  named browser scripts, project-root guard
    3f36a9801  no shelling out unresolvable binaries, refuse UNC paths
    b15435e67  real ACLs on every secret, DPAPI for the token, close the hook port
    17b351608  resolve git/gh from PATH, not from the repo
    c3c2c204a  preload IPC allowlist, telemetry placeholder gate
    ba0ea4240  deny-by-default Chromium permission policy
    ffa7ab2b8  owner-only terminal logs, refuse OSC 52 reads
    afd9425fa  bump 1.17.32
    c0ecbc2b1  pty-daemon 0.2.6
    d54b30680  authenticate the daemon socket, bridge no longer defaults to LAN

**All of it shipped publicly in 1.17.36** on 2026-08-03 — public went straight
from 1.17.31 to 1.17.36, so .32 through .36 landed in one release and no user
ever saw the broken .33. Ship only when the maintainer asks, never on your own
initiative.

## Behaviour changes a user will notice

- **The phone bridge defaults to tailnet-only.** With no Tailscale it does not
  start at all. Deliberate: the old default bound `0.0.0.0` over plain HTTP,
  publishing something that types into a live agent session to every network
  the machine joined. It fails closed now.
- **Settings → the bridge has an "Unpair devices" button.** Rotates the token
  and restarts the server. Before this there was no way to unpair short of
  deleting `~/.superset/bridge-token` by hand.
- **The pty-daemon must restart before socket auth takes effect.** It survives
  app updates on purpose (the user's shells live in it). The bump to `0.2.6`
  marks it stale so the restart path runs.

## Decisions the maintainer made — do not re-litigate

- **`bypassPermissions` stays the default session mode**
  (`ClaudeSessionPane/sessionStore.ts`). He was shown the exposure — a
  malicious repo's README can instruct the agent and nothing pauses — and chose
  speed. Do not "fix" this.
- **No trust gate on repo-supplied setup scripts.** `.superset/config.json` in
  a cloned repo still runs its `setup` commands, and `runSetupScript` still
  defaults to true. Same reasoning, same answer.
- **`allowDowngrade` stays true on canary.** It exists so canary users can drop
  back to stable; the attacker precondition is already repo write.
- **Scrollback logging has no off switch and no redaction.** The exposure was
  the file permissions, and those are fixed. Redacting a raw byte stream is not
  reliable — secrets span chunk boundaries — and half-working redaction reads
  as safe when it is not.

## Known-good baseline for tests

Do not chase these. They fail on a clean tree and are Windows platform
assumptions (POSIX paths, `~` expansion, `.sock` vs named pipes):

- `bun test apps/desktop` → **37 fail** out of 2628 (2026-08-07). The residue is
  `resolvePath` cwd-fallback, `createWorktree` hook tolerance and `runTeardown`.
  The older figure here was 52 fail out of ~2425 on 2026-08-03; the count came
  down because the suite grew and some of those got fixed, not because anything
  is being skipped. Anything above 37 is yours. (Treat a one-off overage as
  flake and re-run before hunting — a stray 53 appeared once against the old
  baseline and never reproduced.)
- `bun test packages/host-service/src packages/pty-daemon/src` → **7 fail**.

**Do not pipe `bun test` into `Select-String` in PowerShell** to filter the
failures. It hangs with no output past the 10-minute cap. Let it print and read
the tail, or write to a file.

Lint and typecheck are expected to be **completely clean**. `bun run lint`
treats warnings as errors.

## Live traps

- **Never import electron at module scope in anything a child entrypoint can
  reach.** It kills the child at load under `ELECTRON_RUN_AS_NODE` and the app
  still opens looking healthy. This shipped in 1.17.33; `validate-native-runtime`
  now catches it. Use a lazy require inside a function.
- **A tRPC procedure that throws without a message surfaces as the literal
  string "Internal error".** It is not a category of failure, it is an empty
  `message` field rendered by the client. If the UI shows it, the first move is
  to add host-side logging, not to guess at causes — 1.17.37 burned a round trip
  on exactly that.
- **A path inside `app.asar` can be READ but never EXECUTED.** Electron patches
  `fs`, so `existsSync` and `readFile` succeed and the path looks perfectly
  real; there is no file on disk for `CreateProcess`/`exec` to open. Anything
  that spawns a binary resolved through `require.resolve` must rewrite
  `app.asar\` → `app.asar.unpacked\` and confirm the unpacked file exists. This
  is what killed every ACP session in 1.17.37, and the adapter reported it as a
  **libc mismatch** — a Linux-shaped error on Windows. Do not chase that
  message; check the path first.
- **The pty-daemon has two entrypoints, synced by hand** (AGENTS.md rule 12).
  The desktop one is the one that ships. This already caused one silently inert
  security fix.
- **`chmod`/`mode` does nothing on Windows** (AGENTS.md rule 13). Secrets go
  through `main/lib/secure-file`.
- **Never pass `--config.directories.output`.** Doing so per build produced 46
  release folders and ~70 GB. `electron-builder.ts` already points at
  `release/`.
- **`bun test` hangs on `test.each` with mixed-type values** (bun 1.3.14). No
  output, no timeout — it just sits. Use a loop inside one `test()`.
- **Installing a build kills any Claude Code session running inside GatedSpace.**
  Commit before handing over an installer.
- **A `ship` that dies mid-watch leaves the release as an unpublished draft.**
  `gh run watch` bails on a transient `error connecting to api.github.com`, and
  if the shell goes with it the script never reaches its final `--draft=false`.
  The build is green and both installers are attached, but a draft serves no
  update manifest, so no installed app sees the update — it looks shipped from
  the Actions tab and is not. **Re-running `bun run ship <version>` does NOT fix
  this**: preflight refuses because the tag already exists on the public remote.
  Finish it by hand and verify:

      gh release edit desktop-v<version> -R yzgershon/GatedSpace --draft=false
      gh release view desktop-v<version> -R yzgershon/GatedSpace --json isDraft

  Cost ~30 minutes of a silently unpublished 1.17.36 on 2026-08-03. After any
  ship, confirm `isDraft: false` rather than trusting the script's exit.
- **The NSIS installer half-installs over a running app, and reports success.**
  This cost an hour on 2026-08-03. Windows locks `GatedSpace.exe` and
  `resources\app.asar` while the app runs; NSIS replaced the Chromium DLLs, the
  uninstaller and `app-update.yml`, silently skipped those two, and exited
  clean. The result is new DLLs over old app code — the title bar still reads
  the old version and every fix looks like it did not work. **Fully quit
  GatedSpace before installing**, and if a build "did not take", check the
  installed version before re-debugging the code:

      node -e "const a=require('@electron/asar');console.log(JSON.parse(a.extractFile(process.env.LOCALAPPDATA+'/Programs/GatedSpace/resources/app.asar','package.json')).version)"

  Compare `GatedSpace.exe` / `app.asar` mtimes against the rest of the install
  directory — if they are older than the DLLs beside them, the overwrite was
  skipped. Worth fixing properly: make the installer refuse to run while the
  app is open instead of doing a partial job.

## Auto-update is unsigned, and that is accepted

`app-update.yml` carries no `publisherName`, so electron-updater's signature
check returns `null` (pass) and installs whatever it downloaded. The sha512 in
`latest.yml` is an integrity check, not an authenticity one — whoever controls
the feed controls both files.

The maintainer has **2FA on GitHub**, which closes the realistic path, and a
certificate is optional at this scale. If one is ever bought it must be wired
through **electron-builder**, not a post-build `signtool` call, or
`publisherName` stays absent and verification stays a no-op while looking
solved.

## Release commands

    # personal build — output goes to apps/desktop/release/, never a new folder
    cd apps/desktop
    GATEDSPACE_PERSONAL=1 bun run prebuild
    GATEDSPACE_PERSONAL=1 bun run build

    # public release (only when asked)
    bun run ship <version> "headline"

Full rules: `docs/RELEASING.md`.

Installers accumulate in `apps/desktop/release/` — the filename carries the
version (`GatedSpace-personal-1.17.34-arm64.exe`), so builds never overwrite
each other and pile up at ~527 MB each. Clear old ones out periodically.

## Open items — raised, not yet decided

None is started. Do not act on them without asking the maintainer.

- **WANTED: a way to test changes without closing GatedSpace.** Every UI or
  feature change currently costs a full personal build plus an install, and the
  install kills any Claude Code session running inside the app. **Dev mode is
  NOT the answer — he tried it, it does not work, and on 2026-08-11 he asked
  that it stop being offered or cited as an excuse.** References to it have been
  stripped from this file; do not reintroduce them. Untried ideas: a second
  Electron instance on its own `--user-data-dir` with the single-instance lock
  bypassed, a portable build unpacked to its own directory, or a canary channel
  installed side by side under a different `appId` (`electron-builder.canary.ts`
  already sets `com.gatedmind.gatedspace.canary`, so most of that exists).
  Raise this next time something needs testing rather than defaulting to
  "build it and reinstall".
- **DIAGNOSED, NOT FIXED: our agent wrappers are unrunnable on Windows.**
  Every file in `~/.superset/bin` written by `agent-setup` — `claude`, `codex`,
  `gemini`, `copilot`, `opencode`, `amp`, `vibe`, `droid`, `cursor-agent`,
  `mastracode` — is a **bash script starting `#!/bin/bash` with no file
  extension**, and that directory is on PATH. Windows cannot execute an
  extensionless file, so it hands it to the shell and the user gets the *"How
  do you want to open this file?"* dialog. The `.cmd` files beside them
  (`claude-acct.cmd`, `glm.cmd`, `superset.cmd`) are correct, so the right
  pattern already exists in that folder; it was never applied to the ten agent
  wrappers. Writer is `agent-wrappers-common.ts` (line ~155 emits the
  `#!/bin/bash` body); the `win32` branch at :25 is about notify hooks and is
  unrelated.

  **It is not architecture-specific** — that was the initial read and it is
  wrong. It is PATH ORDER. The maintainer is masked from it because his Codex
  is npm-installed, so `AppData\Roaming\npm\codex.cmd` resolves ahead of the
  wrapper. Daniel used the standalone OpenAI installer, has no npm shim in
  front, and the dead wrapper wins. Verified by comparing `where.exe codex` on
  both machines. **`PATHEXT` was a red herring** — his contains `.CMD`.

  Reproducible on any machine by renaming the npm `codex.cmd` out of the way;
  no x64 box needed. Deferred by the maintainer 2026-08-09 to the following
  week. Workaround for an affected user is to rename the wrapper, but agent
  setup rewrites it, so it is not a fix.

  Relay note: `\` before `.superset` was repeatedly stripped when pasting
  commands through chat, producing `C:\Users\<name>.superset\...` and a
  confusing "does not exist". Send commands that derive the path
  (`@(where.exe codex)[0]`) rather than spelling it out.
- **The public repo's "CI" workflow has been failing since at least 1.17.36.**
  Not the release workflow — that succeeds — but the plain CI run on the public
  `main` push. **Lint** and **Test** fail; Typecheck, Build, Sherif, Version
  Sync and Build CLI all pass. Identical job-for-job on the 1.17.36 ship
  (`30825449212`) and the 1.17.40 ship (`31250814630`), so it predates the
  question work and the revert. Lint passing locally while failing on CI is its
  own puzzle. Flagged to him 2026-08-08; not chased. Worth fixing because a
  permanently red badge means the next real failure will not stand out.
- **Make the installer refuse to run while GatedSpace is open.** Root cause of
  the wasted hour on 2026-08-03 (see Live traps). A partial install that
  reports success is worse than a failed one.
- **Consider `allowToChangeInstallationDirectory: false`.** It is currently
  true, so the wizard offers a directory page. Picking a different path there
  produces a second parallel install with its own shortcut — you then launch
  one copy while updating the other, which presents exactly like "the fix did
  not work".
