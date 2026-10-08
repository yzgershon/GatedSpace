# Session controls preview

Run from the repository root:

```powershell
node apps/desktop/scripts/preview-session-controls.mjs --serve
```

The URL is printed and written to `.tmp/session-controls-preview/url.txt`. Open it in a **responsive** sidebar browser tab. The server binds only to loopback and uses sample data; question replies never leave the preview.

Omit `--serve` to run the Playwright checks. If Playwright is not directly resolvable, set `PLAYWRIGHT_MODULE` to the installed module's file URL. Checks cover all three concepts at 4/8/16 tabs and 240–720px available widths, permanent + access, add/close/search/switch, directional fades, real question-card choice/Other/multi-question/retry delivery, real pill sizing, and real production TabRail containment. Results and dark/light/narrow screenshots go to `.tmp/session-controls-preview/`.

The user selected **A combined with the existing hover expansion**. The selected-design fixture uses the actual production TabRail: one expanded tab, contracting peers, directional edge fades, arrows, a searchable tab switcher, mouse-wheel support, and a fixed + button. Pointer drag reordering remains on its original implementation. Tests also cover keyboard navigation and hover contraction. The three original concepts remain available below for comparison. The production fixture uses a real workspace store and mocked notification/context services. Question cards and changes pills also use actual app components; transport is mocked.

Design direction: UI UX Pro Max for accessible interaction and sizing; Awesome DESIGN.md's Linear reference for quiet hierarchy and borders. GatedSpace's theme tokens, typography, and agent marks are retained. No installer is built by this script.
