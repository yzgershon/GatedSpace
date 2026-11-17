# Live code verification

`node scripts/live-code/verify.mjs` (from apps/desktop) bundles the real LiveCode
components and CodeMirror editor into `.tmp/live-code-production` at the repo
root. Set `PLAYWRIGHT_MODULE` to the installed Playwright index.mjs when the
package is not directly resolvable. This is a browser fixture with simulated
provider events and filesystem IPC, not a live provider or installed-app test.

The mock rejects requests without session scope, reproducing the old workspace
ID mismatch. Checks cover typing, deduplication, selection/follow, keyboard and
pointer resizing, read/watch failure recovery, draft/mount preservation, no idle
polling, watch cleanup, reduced motion, responsive layouts, file icons and Diff.

Opening index.html without `?test` starts an interactive demo. Play edit updates
the sample source through the real session store. File tabs, Code/Diff, wrapping,
follow, resizing and Return to conversation use production components.

Native tests (Bun):

```
bun test src/renderer/components/LiveCode/live-code-files.test.ts src/lib/trpc/routers/filesystem/session-file-scope.test.ts
```

These use real temporary files, main-process session-folder validation, and a
native Windows directory watcher through an atomic save. They don't start an
agent or change its permissions. Read access is derived from the main-process
session, not a client-supplied cwd. Legacy workspace readers retain their API.

The UI keeps GatedSpace's Dracula colors and existing file icons. Linear's
community DESIGN.md reference informed density and hierarchy; taste guidance
informed preservation of the native product layout. No new design framework.
