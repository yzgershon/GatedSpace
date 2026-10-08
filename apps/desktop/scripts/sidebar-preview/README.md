# Sidebar and queue design preview

Run `node apps/desktop/scripts/preview-sidebar.mjs` from the repository root.
The interactive preview is served at http://127.0.0.1:52135.

This is a local interaction prototype with sample data. It does not send agent
messages, read private transcripts, modify workspaces or pin live sessions.
No installer is built for these designs until the user picks a direction.

## Directions

- Focus: compact title-first rows, pinned sessions and date groups; workspace tree.
- Collections: project groups and contained workspace sections with recent sessions.
- Activity: questions and running work first; status-oriented rows with context.

All preserve GatedSpace's Dracula surfaces, pink accent, agent logos and Segoe UI.
They offer cross-agent search, Claude/Codex pins, filters, rename, archive with Undo,
workspace favorites, active-only filtering and a sample workspace creation flow.
Repeated clicks on the active sidebar tab do not collapse the sidebar.

The queue is attached to the composer, uses FIFO delivery after a simulated turn,
supports edit/save/cancel, delete/undo and sending to the current turn. Stopping
pauses queued work. Editing prevents simulated dispatch until resolved. Text-only
here; the production implementation must retain attachments and model/settings
with each entry, keep queues per pane across unmounts, and handle send failures
without losing queued messages. No real transmission is wired in this preview.

## Design basis

UI UX Pro Max: keyboard access, state clarity, disclosure, responsive layout.
Awesome DESIGN.md Linear reference: hierarchy, quiet borders and information density;
adapted to GatedSpace's existing palette, not an official Linear component system.
Taste: targeted evolution; design variance 4, motion 3, density 7. Only state feedback
animates, and reduced motion is respected. Marketing imagery rules do not apply to
this working desktop navigation prototype. Light mode is included for theme testing.

## Production follow-up after selection

Implement durable queued-message delivery in both native session managers, integrate
composer rows, add provider-neutral pin persistence with existing Codex pins retained,
apply the selected sidebar structure without changing pane/navigation behavior, then
run lifecycle, queue, persistence and packaged UI checks before a committed build.
