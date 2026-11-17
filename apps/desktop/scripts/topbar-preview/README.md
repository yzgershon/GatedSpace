# Floating tab hover preview

Approved interactive design reference. Open `index.html` directly or pass this
folder to GatedSpace `browser_open` as `previewDirectory`.

The proposed header removes the redundant agent launchers, centers a wider rail
against the whole window, and keeps the build button compact beside the window
controls. Ten tabs fit at normal desktop widths; additional tabs scroll. The
selected title shows fifteen characters before `...`; the hover card has its full
name. Equal space is reserved beside the rail to avoid colliding with controls.

**Stable hover** keeps all tab hit targets still. After 120 ms, the hovered icon
lifts slightly and an anchored name card opens below it with a 240 ms eased
entrance. Only selection changes the active tab width. **Old movement** reproduces
the expanding neighboring slots for comparison. The user approved Stable hover
and whole-window centering on November 16. That behavior is now implemented in
the source; the installed app has not been changed.

Try Show hover demo, hover and click different tabs, drag to reorder, arrow-key
selection, Alt+arrow reordering, Search, Try 16 tabs, and Build circle demo. The
demonstration cursor never controls the real cursor. Window-size presets show
1100, 1440 and 1920 CSS pixels. A narrow panel scales the desktop canvas; expand
the sidebar for full-size interaction. Reset cancels the simulations.

Sessions, messages and build progress are simulated. No provider, account,
desktop or workspace APIs are called. Related source UI/search changes are
separate from this preview and have not been installed or packaged this turn.

Design retains GatedSpace's Dracula palette, provider SVG marks, Segoe UI and
Lucide icons. Awesome DESIGN.md's Linear reference informs density and contrast;
the taste skill's preservation and interaction principles guide app chrome.
Reduced-motion support disables entrance/transition animation. Idle rendering
uses no polling loop.
