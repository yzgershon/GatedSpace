# Releasing GatedSpace

GatedSpace is a Windows-focused fork of Superset. A change usually reaches users
two ways, and **most changes want BOTH** unless you were told to scope it to one:

1. **Public release** — the GitHub release every installed app auto-updates from.
2. **Personal / dev build** — a hand-installed build for the maintainer's own
   machine, which does NOT auto-update.

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

The maintainer's installed app does NOT auto-update — it's replaced by a deliberate
reinstall. Personal builds **omit** the local-only flag so they stay cloud-capable
(they talk to the maintainer's local stack rather than the public build's
local-only restrictions).

```bash
cd apps/desktop
GATEDSPACE_PERSONAL=1 bun run prebuild
GATEDSPACE_PERSONAL=1 bun run build
# → apps/desktop/release/GatedSpace-personal-<version>-<arch>.exe
```

The `-personal` in the filename separates it from public-release installers in the
same folder. Hand it over; the maintainer closes GatedSpace, runs the installer,
reopens (terminals survive via the pty-daemon).

Public release builds are the opposite: CI bakes `NEXT_PUBLIC_LOCAL_ONLY=1`, so
they are local-only with no account/cloud. Don't set `GATEDSPACE_PERSONAL` for
those — CI produces them from the `ship` snapshot.

---

## Before you commit anything for a release
- `bun run lint` must exit 0 (run a repo-wide `biome check` after formatting). The
  lint script treats warnings as errors.
- Typecheck the affected packages, e.g. `bun x turbo typecheck --filter=@superset/desktop`.
- No `Co-Authored-By: Claude` (or any co-author) on commits.
- **One session edits the tree at a time.** Before starting, check `git status` and
  recent commits — another session may have work in flight. If you find uncommitted
  work that isn't yours, preserve it on a branch (`git checkout -b wip-<thing>`,
  commit the explicit files, `git checkout windows-port`) rather than discarding it.

## Where to ship FROM
Ship from the primary checkout at `C:\Dev\superset` on `windows-port`. GatedSpace
agent sessions run in isolated git worktrees; if you're in one, land your committed
changes on `windows-port` in the primary checkout first, then ship from there.
