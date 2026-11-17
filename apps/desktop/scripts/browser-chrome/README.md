# Browser chrome verification

`node apps/desktop/scripts/check-browser-chrome.mjs` renders the actual ToolPanel,
ToolTab, BrowserPaneToolbar and preview-size menu with simulated page state and
IPC. It checks a 55-tab strip, neighbor selection after closing, manual scroll
preservation, wheel scrolling, narrow widths, address entry and toolbar actions.
Set PLAYWRIGHT_MODULE to the installed Playwright module if it is not on the
normal module resolution path. Output: `.tmp/browser-chrome-preview/`.

`bun scripts/browser-chrome/verify-launch.ts`, from `apps/desktop`, exercises the
production Chrome launcher and saved-preview bridge using an isolated profile.
It opens two test tabs in the user's Chrome, verifies browser callbacks from the
website and saved preview, and exits. It neither installs nor restarts GatedSpace.
Output: `.tmp/chrome-launch-verification/results.json` at the repository root.

The saved-preview bridge serves only already-captured static files on loopback,
with separate origins per preview, a one-use bootstrap ticket and an HttpOnly
cookie. It preserves root-relative assets, routes, query strings and fragments.
Those URLs remain available while the hosting GatedSpace process runs. Websites
open directly and use Chrome's own login state.
