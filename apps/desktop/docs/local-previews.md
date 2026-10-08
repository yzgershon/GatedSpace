# Persistent local previews

For an agent-generated static preview, call `browser_open` with `previewDirectory`
set to its bundled output folder inside the session workspace. The folder must
contain `index.html`. An optional loopback `url` preserves its route and query.
Reopening the same folder updates the existing preview rather than adding a tab.

GatedSpace copies the HTML, scripts, styles, images, fonts and JSON into the
owner-only `browser-previews` directory under its profile. A stable
`gatedspace-preview://` address serves that copy in the browser partition without
a server process or port. Reopening the app, updating its installation, deleting
the temporary output, and refreshing the tab do not require the original server.
No installer changes or running-app restart are required to execute the tests.

Known older generated previews can be recovered from `.tmp/*preview/url.txt` or
`check-url.txt` under an active session's workspace (or an immediate child project).
Recovery requires an unambiguous matching loopback origin and `index.html`.
Unsupported or ambiguous URLs remain unchanged. Failed-page Retry navigates to the
original URL instead of refreshing Chromium's error document.

This mechanism is for static previews, including bundled React/Vite output. Live
development apps that depend on a backend still need their development server.
GatedSpace does not guess or run arbitrary commands when restoring those tabs.
Select only the generated output directory; dot files, symlinks, dependencies and
unsupported source files are excluded. Copies are limited to 64 MB, 5,000 files,
10,000 directory entries and 32 directory levels.

Verification from the repository root:

```sh
bun test apps/desktop/src/main/lib/browser/local-preview-store.test.ts
bun apps/desktop/scripts/verify-local-previews.cjs
```

The second check starts two hidden Electron test processes with an isolated profile
and a real webview. It verifies button interaction, CSS, fetch, reload, and reopen
after deleting the original output. Evidence stays in `.tmp/preview-electron-*`.
