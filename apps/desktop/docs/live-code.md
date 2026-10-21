# Live code

The code icon in a Codex or Claude session header opens a read-only editor beside the existing conversation. It uses the pane's normal expand behavior and restores the previous layout on return. It does not create, fork, prompt, or restart an agent. Existing composer draft stores preserve drafts across the pane layout change.

File discovery uses provider edit metadata for the current turn. It does not scan Git or the workspace. Only the selected text file is read (512 KB maximum). A non-recursive watch of its parent directory catches ordinary and atomic saves; unrelated paths are ignored. The watch and editor are disposed when leaving Live code. Refresh and subsequent provider events also update the view if a filesystem watch is unavailable. Files written exclusively by arbitrary shell commands may only appear when the provider reports a turn diff.

Typing is a renderer-only effect after file contents arrive. It has no effect on the saved file or agent execution. New updates supersede unfinished animation. A change catches up within 32 animation frames; insertions larger than 32 KB, reduced motion, and hidden documents skip animation. The existing editor language loader supplies syntax highlighting. The CodeMirror bundle is loaded on demand.

Follow selects the most recently reported edited file; selecting a file pauses following. Diff compares the current file with its first observed contents in this view, as its labels state. It is not a Git base or a complete task diff. Deleted, binary, oversized, and unavailable files show an explicit readable state.

Verification: `bun test src/renderer/components/LiveCode/live-code-files.test.ts` from `apps/desktop`, and `node apps/desktop/scripts/live-code/verify.mjs` from the repository with `PLAYWRIGHT_MODULE` pointing to the installed Playwright entry. The latter exercises production UI with deterministic IPC fixtures; it does not run a live agent or test the installed application. The approved standalone design preview remains under `plans/20261014-live-code-preview`.
