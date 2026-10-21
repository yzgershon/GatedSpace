# Flow composer dictation

Both native session composers use the existing model/effort and permission controls behind separate icon buttons. Clicking the microphone starts Flow; clicking it again finishes transcription and inserts text into that same composer without sending it. Typing during recording is preserved. Closing the composer cancels its capture.

The main process connects to the same-user Windows named pipe `GatedSpace.Flow.<username>`. Flow protocol 1 accepts newline-delimited `status`, `start`, `stop`, and `cancel` commands and returns JSON lines. The connection owns its recording; disconnect discards unfinished audio. Status checks never start recording. The renderer never synthesizes desktop hotkeys or pastes into the foreground window.

Install a Flow build containing its `ComposerPipe` integration (Flow commit `71b7d06`). The launch lookup is `FLOW_APP_EXE`, `C:/Dev/Flow/dist/Flow.exe`, then `%LOCALAPPDATA%/Programs/Flow/Flow.exe`. An older running copy produces an actionable error. Flow remains a separate application; its models, settings and history are unchanged by the GatedSpace installer.

Validation: `node apps/desktop/scripts/verify-flow-connection.mjs` checks the real Node named-pipe client without microphone access. Run `apps/desktop/scripts/test-codex-session.ts` with Node and `COMPOSER_REFRESH_ONLY=1` for production composer and expanded-tool-panel checks. The Flow text is simulated in browser tests; audio quality requires a real microphone test.

The expanded-preview activity footer uses the owning session's public progress messages and tool events. It excludes reasoning content and marks completion only from a completed turn/result. Its footer occupies real layout space so Electron's native browser view cannot cover its buttons. Returning restores the preview and focuses the owning session.
