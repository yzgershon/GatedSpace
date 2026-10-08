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
# Bun automatically runs prebuild before build; do not run it twice.
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

Personal builds apply the committed, nonsecret backend profile in
`apps/desktop/vite/personal-backend.ts` after loading dotenv. API (3001), web
(3018), streams (3007), and Electric (3012) use localhost in every personal
snapshot, including isolated checkouts with no `.env`. No credentials are copied
to the build checkout. Public/development builds keep their existing configuration.
The bundle verifier checks concrete endpoint bindings in both main and renderer,
before packaging and again in the extracted installer. A local URL appearing
elsewhere in the bundle is not proof that the auth client uses it.

Personal 1.18.39 was withdrawn: its isolated checkout omitted `.env` and silently
compiled upstream hosted endpoints, stranding existing local accounts at sign-in.
The original artifact integrity checks passed but did not test endpoint identity.
1.18.40 adds this independent check and an explicit profile. Do not re-offer .39
or reset a user's session data to work around this build error.

Updater verification: `bun test src/main/lib/personal-update.test.ts
src/main/lib/auto-updater-personal.test.ts` from `apps/desktop`. The routing test
isolates personal and public channels in subprocesses.
`node scripts/test-personal-update.ts` exercises the real Windows launcher using
a harmless test executable, including parent-exit, timeout and failure cases.

Public release builds are the opposite: CI bakes `NEXT_PUBLIC_LOCAL_ONLY=1`, so
they are local-only with no account/cloud. Don't set `GATEDSPACE_PERSONAL` for
those — CI produces them from the `ship` snapshot.

### Personal ARM64 verification and recovery

Use the committed `scripts/release/verify-personal-installer.ts` for every personal
ARM64 build. Do not copy and edit a previous version's verifier from `.tmp`.
The version, source commit and installer filename come from the build job and
snapshot; dependency locations are resolved from the snapshot's electron-builder.

`prebuild` and `prepackage` now run `validate:personal-bundle` automatically for
`GATEDSPACE_PERSONAL=1`. It checks the compiled JavaScript and CSS against the same
contract used after packaging. For a manually compiled build, run this before
electron-builder (from the committed snapshot):

```powershell
bun scripts/release/verify-personal-installer.ts --preflight
```

After packaging, run:

```powershell
bun scripts/release/verify-personal-installer.ts --repo $snapshot --job $jobFile --receipt "$jobDir/receipt.json"
if ($LASTEXITCODE -ne 0) { throw 'Installer verification failed; see the verifier output' }
```

This tests and extracts the archive, matches every compiled JS/CSS/HTML asset in
both directions, verifies the personal-channel contract, checks ARM64 executable
and native binaries, and verifies installer size/hash against `latest.yml` plus
blockmap presence. Keep the compiled UI interaction checks and final copied-file
hash/updater-discovery checks; they prove separate parts of the release. Mark
Ready only when all pass. Preserve the verifier's specific failure in the job
message instead of reporting only a generic "Packaged file verification failed."

If packaging succeeded and only verification failed, inspect the precise failure
and check the snapshot is still clean at the job's source commit. Correct verifier
errors, then run the committed verifier against the existing installer. Do not
recompile, repackage or bump the version just to recover verification. Record the
recovery and verifier changes separately from the installer's original source
commit. Only copy the installer/update files and report Ready after verification.

The 1.18.37 false failure came from an invented `gs-tab-close` marker (the component
uses `gs-tabrail-close`) and treating unused dropdown CSS as active dropdown UI.
Regression tests cover both cases. Rejecting removed UI must inspect executable
JavaScript or actual DOM behavior; leftover CSS alone does not establish that the
UI is rendered. Never remove an integrity check just to turn a build green.

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

For public builds, check the release workflow's final status and source snapshot
before interpreting a local watcher exit as a build failure. The watcher can stop
after GitHub has already created both installers and the draft. Record local exit
codes for diagnosis; require a successful workflow and an exact source-tree match
before verifying artifacts. If those checks pass, resume download, verification,
and publication of the existing draft. Do not rebuild or retag that version.

In Windows PowerShell workers, assign JSON arrays before filtering them:
`$releases = $json | ConvertFrom-Json`, then
`$release = $releases | Where-Object tag_name -eq $tag`. Wrapping the conversion
in `@(...)` directly before `Where-Object` can leave the array nested and miss an
existing draft. Check native process exit codes explicitly, and capture redirected
stderr without letting ordinary command output abort retry loops.

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

### Repeatable personal ARM64 worker

Use the committed worker instead of generating a new PowerShell worker for every
version. Prepare the isolated checkout at the committed source revision, create
an ordinary personal build job JSON (timestamps use JavaScript `toISOString()`),
then launch this command hidden/detached with stdout and stderr in its job folder:

```powershell
bun scripts/release/report-build.ts run --file <job.json> -- bun scripts/release/personal-worker.ts --repo <isolated-checkout> --primary C:/Dev/superset --job <job.json>
```

Run this from the isolated checkout. The worker strips the two Windows environment
variables that break Electron, asserts a clean exact commit, acquires an exclusive
build lock, prepares native dependencies once, compiles once, runs the committed UI
checks with release styles, packages without another native rebuild, verifies the
actual installer, then checks copied-file hashes and local Update discovery. It
never installs or publishes. The standard `apps/desktop/release` output is retained.

The personal worker enters electron-builder through `windows-packager.cjs`. On
Windows it uses fs-extra's native Windows realpath implementation, preserving
Promise/callback behavior and all of electron-builder's path safety checks. No
path results are cached. A same-snapshot ARM64 comparison reduced unpacked-app
packaging from 11m13s to 2m17s with byte-identical ASAR and unpacked runtime files.
This is a packaging measurement, not a promised end-to-end installer duration.
The subsequent full personal 1.18.39 worker run took 13m09s, including fresh app
compilation, five UI suites, installer compression, and final verification, with
no failed phases or restart. Its packaging phase took 9m16s, so the isolated
benchmark should not be used to predict a full worker's duration.
The wrapper falls back to standard resolution if an upstream module layout changes.
Run `node --test scripts/release/windows-packager.test.cjs` to check junction
retargeting, missing files, callbacks, and rejection of links into Windows.

`personal-checkpoints.json` beside the reusable checkout records successful phases
with input and output hashes. A resumed job reuses compilation/packaging only when
their inputs and every output still match. Failed/interrupted phases are not cached.
Verification always reruns against the installer. To resume, set the same job to
`building` with a new ISO timestamp, then rerun the same command; do not bump the
version or discard the completed installer just because a check failed. App inputs
exclude test harnesses/docs, allowing a verifier-only correction to reuse the app.
The worker still requires a clean committed snapshot and records the new commit.

Each phase has its own log in the job directory; `timings.json` records elapsed time
and reused phases. The persistent build chip is updated throughout. Keep the
completion notification enabled when launching the detached wrapper, and record
job identity/log paths in `HANDOFF.md` as usual. Native dependencies and source maps are validated inside prebuild before maps are
stripped. A successful compile checkpoint attests that sequence; do not rerun the
source-map validator against stripped output. The packaged native architecture and
file-content checks still run on every attempt.
