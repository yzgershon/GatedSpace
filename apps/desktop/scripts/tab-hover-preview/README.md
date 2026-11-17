# Floating tab and pane-preview design

Interactive approval preview for the November 16 follow-up. Open index.html or
use this folder as GatedSpace browser_open's previewDirectory.

The rail fits its contents, capped at ten visible tabs when space allows. Icons
are 28px. Hover lifts an inner visual layer by 1px while every tab hit target
stays still. A 240ms intent delay opens a taskbar-inspired preview of the whole workspace; a 260ms
exit grace period lets the pointer cross into it. Click the single thumbnail to open the tab. Provider marks remain inside the
miniature pane headers; there is no extra agent row or instructional footer. Escape dismisses it. Keyboard arrow
navigation and reduced motion are supported. There is no idle animation loop.

Rail and composers share a 2px Dracula-pink outline and restrained glow. Recent
session rows have no drag-handle column; the whole row reorders sample sessions.
Try 3/6/10/16 tabs, Show hover demo, College's three-provider preview, composer
input, and sidebar search. Narrow preview panels scale a desktop canvas; expand
the panel to inspect at full size.

All conversations and thumbnails are sample content, not screen captures or
live providers. No account, session, desktop, or messaging APIs are called.
This is a visual proposal, separate from the production preference-persistence
and recent-row drag fixes. It has not been installed or packaged.

Design: preserves GatedSpace's Segoe UI, provider marks, and Dracula identity.
Awesome DESIGN.md's Linear reference informs density and legibility; the taste
skill informs preservation of existing product conventions. This is not a
Fluent UI implementation.

Revision: the user requested a subtler lift and a single compact snapshot. The
card is now 344px wide for both one-pane and mixed-provider tabs. The user approved the subtle hover and requested removal of the agent shortcuts
and footer. The preview now ends immediately beneath the workspace thumbnail.
The header contains only the tab title and provider mark, with no pane count or
status line, keeping the card compact.
