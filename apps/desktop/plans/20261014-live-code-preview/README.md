# Live code workspace preview

An isolated, interactive design preview. It uses CodeMirror (already used by GatedSpace), Dracula tokens, and the production composer settings menus. All edits, messages, status and dictation are simulated. It never reads or writes a project file or runs an agent.

Run `node apps/desktop/plans/20261014-live-code-preview/build.mjs`, then open the generated `dist` folder with GatedSpace's durable preview browser. Run `verify.mjs` with the local Playwright module to check the interactions and capture screenshots.

The Live code button places the same conversation beside the code. It keeps the draft and messages when returning to Conversation. Follow changes switches to the file the agent is editing; selecting another file pauses following without stopping the demo. The divider resizes the conversation. The code streams in small character updates with a visible caret; Pause preserves the current partial edit. Side-by-side works from 620 CSS pixels; narrower previews stack the editor above the session instead of shrinking a desktop canvas.

Design: preserve GatedSpace's existing dark surfaces, pink accents and compact composer. Use editor density, line numbers, syntax colors and changed-line markers. Moving the session is visual; it must not fork or restart the agent when implemented. Live production updates should reflect actual file/patch events, not fabricated keystrokes. The current backend is not connected in this preview.
