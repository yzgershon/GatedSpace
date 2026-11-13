# GatedSpace Friends and shared projects concept

Open `index.html`, or serve this folder through GatedSpace `browser_open` with
`previewDirectory`. No backend, provider calls, or real invitations are used.

Opening a friend puts three prominent session panes in the main area, with
project chat beside them. Each pane shows its owner, responsibility, state, latest
shared message, and artifact. Open a session to focus its shared conversation;
switch to Shared output to inspect Claude's calendar, Codex's code, or Gemini's
research. All sessions returns to the overview. Drag the divider (or use its
arrow keys) to resize project chat. Narrow panels stack sessions and offer a
chat toggle. New simulated messages update the corresponding session pane.

Try Add a friend, a pending request, and Simulate acceptance. This changes only
the local demo list; becoming friends does not automatically share a project.
Session details, code review, reply threads, sharing scopes, demo project invites,
and disconnect/send/reconnect are interactive. Play handoff runs a finite scripted
exchange that can pause and resume. Reduced motion is supported.

Verify from the repo root with `node apps/desktop/scripts/verify-rooms-preview.mjs`.
This checks the interactions in Chrome, including 390, 515, 800, and 1100 px
layouts. Screenshots and results go to `.tmp/rooms-preview-verification/`.

Design: a native GatedSpace feature, retaining Dracula surfaces, pink controls,
compact navigation, and existing provider icons. The Awesome DESIGN.md Linear
reference informed hierarchy and restrained borders; the taste skill informed
the density and avoidance of decorative page sections. No marketing layout.

Product boundary: friendship or room membership does not imply remote computer control or
access to private sessions. A future implementation would need authenticated
invitations, explicit per-session sharing, durable message delivery, per-user
permissions, and versioned artifacts. Queued/delivered states here are simulated.
