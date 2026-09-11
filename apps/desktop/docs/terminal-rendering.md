# Terminal rendering regression: CSS zoom and the WebGL viewport

The blank PowerShell prompt and clipped agent terminals reported against 1.18.4
were reproduced under Electron 40.8.5 with the installed xterm packages:
`@xterm/xterm` 6.1.0-beta.220 and `@xterm/addon-webgl` 0.20.0-beta.219.

## Cause

GatedSpace applies CSS `zoom` to the main UI. The WebGL addon's
`observeDevicePixelDimensions` observes the canvas's actual device-pixel box and
updates its backing width and height. However, `GlyphRenderer.handleResize`
configures `gl.viewport` using the logical grid's device dimensions, which do
not include ancestor CSS zoom. Resizing the backing canvas does not update that
viewport.

At 0.85 zoom in the real terminal runtime regression:

| Measurement | Value |
| --- | --- |
| Terminal grid and FitAddon proposal | Both 112 columns × 32 rows |
| Logical canvas | 1792 × 1152 |
| Actual canvas drawing buffer | 1523 × 979 |
| GL viewport before the fix | 1792 × 1152 |
| GL viewport after the fix | 1523 × 979 |

The larger viewport draws the first rows above the canvas and loses columns on
the right. A newly opened shell has only its prompt in those first rows, so it
appears completely blank. This is reproducible without a shell, transport race,
saved terminal state, or unloaded fonts. CSS layout and FitAddon measurements
can all be correct while the screen is wrong.

## Correction

`src/renderer/lib/terminal/webgl-viewport.ts` synchronizes the viewport with
`drawingBufferWidth`/`drawingBufferHeight` before each renderer draw, including
the synchronous redraw triggered by xterm's canvas ResizeObserver. Logical
cell metrics and shader uniforms stay unchanged. The user's UI scale and
hardware acceleration are preserved.

The addon has no public before-render callback. The compatibility adapter uses
its pinned `_renderer`, `_gl`, and `renderRows` members, validates their shape,
and restores the original method when disposed. An incompatible addon uses
xterm's DOM fallback. Run the real Electron regression before upgrading xterm;
remove the adapter when the dependency handles the viewport itself.

Changing renderers also requires a refit: the DOM and WebGL renderers round
character widths differently. The runtime now refits and reports the resulting
grid through the current PTY resize callback on activation or fallback. The
context-loss regression exposed a 45-column WebGL grid becoming a 44-column
DOM grid in the same container.

Repaint recovery no longer writes `ESC[0m` into the terminal stream. That sequence
changes the program's active formatting and can interrupt an escape sequence;
repainting only needs to refresh the renderer.

## Verification

From `apps/desktop`:

```sh
bun test src/renderer/lib/terminal
bun run scripts/test-terminal-rendering.ts
bun run scripts/test-terminal-rendering.ts --baseline
bun run typecheck
```

Run `bun run lint` from the repository root.

The Electron fixture runs in a hidden window with an isolated user-data folder.
It uses the actual GatedSpace runtime, addons, and font defaults. Only clipboard
settings and keyboard-layout IPC are stubbed; no installed-app state, daemon,
accounts, or real agent sessions are opened. It compiles a test fixture, not an
installer. Reports and screenshots go to `.tmp/terminal-rendering/`.

The fixed suite checks:

- Idle prompt visibility and all four corner cells at 0.85, 1.0, and 1.2 zoom.
- Zoom changes without new terminal output, split resizing, parking and
  reattachment, and font changes.
- Alternate-screen and synchronized-output rendering.
- Preservation of output formatting across a forced repaint.
- Graphics-context restoration, DOM fallback, and a new WebGL terminal after
  another terminal loses its context.
- Agreement between the fitted grid, reported PTY size, and actual GL viewport.

As of 2026-09-10: 15 Electron checks and 293 terminal unit tests pass. Desktop
typechecking and repository lint pass. `--baseline` deliberately disables only
the viewport correction; it must exit nonzero at `idle-0.85`, with a correct
112×32 grid but a 1792×1152 viewport over a 1523×979 drawing buffer. Its screenshot
shows the missing idle prompt. This control prevents a passing test that merely
assumes fitting the grid fixes the visible screen.

These checks verify the local source. Installing a newly approved personal build
is still required to apply the correction to the maintainer's running app.
