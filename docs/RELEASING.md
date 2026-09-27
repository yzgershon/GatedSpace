# Releasing GatedSpace

GatedSpace is a Windows-focused fork of Superset. A change usually reaches users
two ways, and **most changes want BOTH** unless you were told to scope it to one:

1. **Public release** — the GitHub release every installed app auto-updates from.
2. **Personal / dev build** — a build for the maintainer's own machine, updated
   from the local release folder through the app's Update button.

## Use the right command — there are two, and they are different

| Command | What it's for | Use it for GatedSpace? |
|---|---|---|
| `bun run ship` | THIS fork's public releases → `yzgershon/GatedSpace` | ✅ **yes — this is how GatedSpace ships** |
| `bun run release` | Upstream Superset's release flow (dedicated release branch) | ❌ not for GatedSpace public releases |

If you remember one thing: **public GatedSpace releases go out with `bun run ship`.**
`bun run release` is inherited from upstream and is the usual source of "how do I
ship this?" confusion.

---

## 1. Public release — `bun run ship`

From the repo root, on branch `windows-port`, with a clean tracked working tree:

```bash
bun run ship <version> "one-line headline"
# e.g.  bun run ship 1.15.6 "screenshot paste fix"
```

That one command does the whole dance:

- bumps `desktop` + `host-service` + `cli` to `<version>` and commits it
- pushes `windows-port` to the private `archive` remote (full history)
- squashes the tree into ONE snapshot commit on public `main` (via `git commit-tree`)
- tags `desktop-v<version>` on that snapshot
- watches the **Release Desktop App** workflow (builds x64 + arm64)
- publishes the release → every installed app offers the update within a few hours

Flags: `--dry-run` (plan only, touches nothing), `--no-publish` (leave a draft),
`--daemon` (also patch-bump pty-daemon).

### Preflight — what `ship` refuses to run without
- `gh` installed and authenticated (`gh auth status`)
- on branch `windows-port`
- **no modified/staged _tracked_ files.** Untracked files (e.g. a local `HANDOFF.md`)
  are FINE and do **not** block the ship — only tracked changes do. Commit or stash
  tracked changes first.
- `origin` = `yzgershon/GatedSpace`, `archive` = the private dev mirror, both set
- `desktop-v<version>` is not already a tag on the public remote (pick a new number)

### Version numbers
- Use the next unshipped `MAJOR.MINOR.PATCH`. The script bumps FROM the current
  version — **don't pre-bump.** If the tree already sits at the target it just
  skips the bump and continues.
- Newest shipped version: `gh release list -R yzgershon/GatedSpace`.

### Rules that keep a public ship from going wrong
- **Never `git add -A`.** A stray 1.2 GB `app.asar` under `apps/desktop/release-*/`
  got swept into a commit once and GitHub rejected the push (100 MB file limit).
  Stage explicit paths. Those dirs are gitignored now, but the habit still bites.
- **Never push `windows-port` (or any full-history ref) to `origin`.** It would
  republish thousands of upstream Superset commits on the public repo. `ship` uses
  `commit-tree` precisely to avoid that — let it.
- **Always pass `-R yzgershon/GatedSpace` to `gh`.** Without it, `gh` resolves the
  repo from remotes and can pick `upstream` (superset-sh/superset) — the wrong repo.
- `ship` watches the **Release Desktop App** workflow, NOT **CI**. The CI/lint
  workflow may be red from pre-existing, unrelated files — that does **not** block
  the release and is not yours to fix mid-ship.
- If a ship fails partway (transient push error, etc.) it is safe to **re-run the
  same `bun run ship <version>`** — it skips work already done and finishes. For a
  clean slate instead, `git reset --soft HEAD~1` the bump commit before retrying.

---

## 2. Personal / dev build (the maintainer's own machine)

Personal builds offer completed local installers through the Update button and
**Check for Updates** command; they never download a public release. Personal builds **omit** the local-only flag so they stay cloud-capable
(they talk to the maintainer's local stack rather than the public build's
local-only restrictions).

```bash
cd apps/desktop
GATEDSPACE_PERSONAL=1 bun run prebuild
GATEDSPACE_PERSONAL=1 bun run build
# → apps/desktop/release/GatedSpace-personal-<version>-<arch>.exe
```

The `-personal` in the filename separates it from public-release installers in the
same folder. Configure `~/.superset/personal-update.json` with an absolute
`releaseDir` (for example `{"releaseDir":"C:/Dev/superset/apps/desktop/release"}`).
Version 1.18.10 and newer check that folder every 30 seconds, filter by the running
architecture, and require the installer's completed `.blockmap`. Clicking Update
starts an acknowledged helper, closes the app, installs, and reopens it. Launch
errors appear in the app; installer output is recorded in
`%TEMP%/gatedspace-personal-update.log`. Older builds may need one manual install
to acquire this updater fix. Do not run an installer during a user's active work.

The main bundle must bake both `GATEDSPACE_PERSONAL` and
`NEXT_PUBLIC_RELEASE_BUILD`; shell-only variables disappear after installation.

Updater verification: `bun test src/main/lib/personal-update.test.ts
src/main/lib/auto-updater-personal.test.ts` from `apps/desktop`. The routing test
isolates personal and public channels in subprocesses.
`node scripts/test-personal-update.ts` exercises the real Windows launcher using
a harmless test executable, including parent-exit, timeout and failure cases.

Public release builds are the opposite: CI bakes `NEXT_PUBLIC_LOCAL_ONLY=1`, so
they are local-only with no account/cloud. Don't set `GATEDSPACE_PERSONAL` for
those — CI produces them from the `ship` snapshot.

---

## Before you commit anything for a release

### Persistent background build status

Launch detached installer workers through `bun scripts/release/report-build.ts run
--file <job.json> -- powershell.exe -NoProfile -File <worker.ps1>` (hidden window on
Windows). The wrapper maintains a heartbeat and reports a failed worker even if
its own error handler is skipped. The TopBar build chip watches these records in
`~/.superset/build-status`; ready/error notifications survive app restarts until
dismissed. No repository or network polling is used. Heartbeats older than two
minutes show Needs attention, never an indefinite Building state.

The job JSON contains `id` (unique safe filename, including attempt if retried),
`version`, `channel` (`personal` or `public`), `architectures` (`arm64`/`x64`),
`sourceCommit`, `stage` (`building`, `verifying`, `ready`, `failed`), `message`,
`updatedAt` (UTC ISO timestamp), `verified` and `published`. An optional `url` may
point to a GatedSpace GitHub workflow or versioned release. Keep secrets and raw
logs out of these records; use short user-facing messages.

At each phase, the worker updates its job JSON and runs
`bun scripts/release/report-build.ts report --file <job.json>`. Write `ready` only
after installer/package/checksum/update-discovery verification. Public jobs also
require successful publication and public-download checks (`published: true`).
The wrapper treats exit zero without a verified ready record as an error. Build
from the committed snapshot, keep logs and receipts, and record those paths in
HANDOFF.md. Reporting does not install or publish anything by itself.

- `bun run lint` must exit 0 (run a repo-wide `biome check` after formatting). The
  lint script treats warnings as errors.
- Typecheck the affected packages, e.g. `bun x turbo typecheck --filter=@superset/desktop`.
- No `Co-Authored-By: Claude` (or any co-author) on commits.
- **One session edits the tree at a time.** Before starting, check `git status` and
  recent commits — another session may have work in flight. If you find uncommitted
  work that isn't yours, preserve it on a branch (`git checkout -b wip-<thing>`,
  commit the explicit files, `git checkout windows-port`) rather than discarding it.

### Local packaging and Windows file locks

Keep the reusable installer checkout outside workspaces open in GatedSpace, for
example `%LOCALAPPDATA%/GatedSpaceBuild/installer`. Continue using its standard
`apps/desktop/release` directory; do not override the output directory. Verify the
installer there before copying the installer and update metadata to the personal
update folder.

If packaging cannot replace `win-arm64-unpacked/resources/app.asar`, inspect the
lock holder before retrying. The running installed host service can hold a build
archive open. Do not terminate that service during an active session. Recover in
an isolated checkout at the same source commit and record the failed attempt,
retry, and any deferred cleanup in `HANDOFF.md`. Preserve the dependency checkout
while another build uses junctions to it.

## Where to ship FROM
Ship from the primary checkout at `C:\Dev\superset` on `windows-port`. GatedSpace
agent sessions run in isolated git worktrees; if you're in one, land your committed
changes on `windows-port` in the primary checkout first, then ship from there.
