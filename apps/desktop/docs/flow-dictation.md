# Built-in Flow dictation

Claude and Codex composers use the same compact microphone control. Click to
record; click again to transcribe into that composer's draft without sending.
Typing during recording is preserved. Closing the composer cancels its capture.

Both public Windows installers and the personal installer include a private Flow
engine, its English speech model, .NET runtime and Microsoft C++ dependencies.
No separate Flow download, account, cloud API, first-run model download, or system
runtime install is needed. Standalone Flow's settings and history are untouched.

The engine is adapted from GatedVoice/Flow commit `71b7d06` (MIT). Its source,
locked dependencies and notices live in `native/flow-dictation`. `bun run
bundle:flow` prepares `dist/resources/flow-dictation` for `TARGET_ARCH`. The common
`compile:app` path runs it for personal and public builds. Electron Builder checks
checksums and native architecture before packaging and checks the copied resources
after packaging. The helper and model live outside app.asar, with no duplicate
model inside the archive. Build machines fetch pinned dependencies; installed
apps do not download anything for voice typing.

Each capture starts one hidden child process with a random same-user-only pipe.
Protocol 1 supports `status`, `start`, `stop`, and `cancel`. Audio stays in memory.
The helper exits on connection loss, parent exit, cancellation, or app quit. The
composer stops after three minutes, with backend and helper watchdogs as backups.
No global hotkeys, clipboard writes, or foreground-window control are used.

## Verification

- `node scripts/verify-flow-connection.mjs`: real Node pipe transport against a
  fixture server, without microphone access.
- `bun scripts/test-flow-lifecycle.ts`: real capture manager and hidden child
  launches with a fixture Electron lifecycle. Cancels synchronously before any
  microphone command; covers pane ownership, missing assets and app quit.
- `node scripts/verify-bundled-flow.mjs dist/resources/flow-dictation [jfk.wav]`:
  real native engine readiness, errors, disconnect/parent-exit cleanup, local CRT
  loading and optional offline audio transcription. The public whisper.cpp JFK
  fixture must be 16 kHz, mono, 16-bit WAV. Never activates a microphone.
- `node scripts/test-session-links.ts`: production shared microphone control and
  both Markdown renderers in an isolated browser. Dictation text and OS opening
  are mocked; concurrent typing and failures preserve the draft. The broader
  `COMPOSER_REFRESH_ONLY=1` harness currently hits an unrelated missing `query`
  fixture in the model/effort picker; it is not a passing check for this change.

ARM64 and x64 helpers were exercised on Windows ARM64 (x64 under Windows
emulation). Real microphone capture, a clean physical x64 PC, and the next
installer remain release acceptance checks; don't label fixtures as those tests.
