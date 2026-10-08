# Floating tabs review

Run from the repository root:

```powershell
node apps/desktop/scripts/preview-floating-tabs.mjs --serve
```

The local URL is written to `.tmp/floating-tabs-preview/url.txt`. Rebuild the assets without replacing the server with `--build-only`.

This focused preview renders the actual `TabRail` against an isolated in-memory workspace. It never changes real sessions. It supports hover expansion, selection, close, add, pointer reordering, arrows, mouse-wheel scrolling, keyboard navigation, a width slider and theme switching.

The revised direction uses content-sized expanded tabs, centered 40px collapsed tabs, the existing 46px rail height, an alpha edge fade, and fixed arrows/+ with no tab count or dropdown. The user's follow-up explicitly removes provider-colored tab borders; selection uses the existing card background instead. The session pane's existing provider border and the agent's status ring are separate and remain unchanged. Keyboard focus stays visible.

Declare Tailwind's cascade-layer order before the preview stylesheet: dependency CSS can otherwise register the utilities layer before the reset and incorrectly remove tab padding. This preview is for design review; it does not build an installer or establish approval to ship.

Motion uses a 130ms hover-intent delay, 200ms exit grace, and matching 180ms width transitions. Label widths are measured from the text so short titles do not race open or snap shut. Hover preserves horizontal scroll; keyboard focus, selection and arrows still control navigation. Reduced motion disables transitions.

With the preview running, run `node apps/desktop/scripts/verify-floating-tab-motion.mjs` (set `PLAYWRIGHT_MODULE` to the installed Playwright ESM entry if it is not resolvable). This samples real animation frames and checks collapse continuity, stationary-pointer stability, tiny movements, brief exit/re-entry, rapid sweeps, narrow controls and reduced motion. The broader controls harness also covers keyboard navigation, manual scrolling, pointer drag and add/close actions.
