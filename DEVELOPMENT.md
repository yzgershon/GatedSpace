# Developing GatedSpace

This guide is for contributors building GatedSpace from source. If you just
want to use the app, [download the installer](https://github.com/yzgershon/GatedSpace/releases/latest)
instead.

## Prerequisites

| Tool | Notes |
|:-----|:------|
| [Bun](https://bun.sh/) | Version pinned in `.bun-version` |
| [Node.js](https://nodejs.org/) | LTS is fine; needed by electron-builder and native module rebuilds |
| Visual Studio 2022 C++ build tools | Windows only, for native modules (node-pty, better-sqlite3, etc.) |
| Git 2.20+ | On PATH |

Windows x64 and ARM64 are the primary targets of this fork. The upstream
macOS/Linux paths still exist but are not what this repository tests.

## Build and run the desktop app

```bash
git clone https://github.com/yzgershon/GatedSpace.git
cd GatedSpace
bun install
cd apps/desktop
bun run dev          # run the app in dev mode
```

To produce an installer like the released ones:

```bash
bun run compile:app
bun run package -- --publish never
# result lands in apps/desktop/release/
```

Public release builds additionally set `NEXT_PUBLIC_LOCAL_ONLY=1` in the
compile environment, which bakes in local-only mode (no sign-in, every feature
unlocked). Building without that flag produces an app that expects the
upstream cloud backend; you almost always want the flag.

Cross-building x64 installers from an ARM64 machine (or vice versa) works:

```bash
TARGET_ARCH=x64 bun run package -- --publish never
```

## Common commands

```bash
bun run test                                 # run tests (turbo, all packages)
bun x biome check .                          # lint + format check
bun run typecheck --filter='!electric-proxy' # type-check (electric-proxy is upstream cloud infra)
```

Notes for Windows contributors:

- A number of upstream tests assume Unix (symlinks, socket paths, `/Users`
  paths) and fail locally while passing on Linux CI. Judge your branch against
  CI results, not a local zero.
- The lint pipeline fails on **any** Biome diagnostic, including warnings, and
  Biome caps console output at 20 diagnostics, so run the repo-wide check
  before pushing.

## Repository layout

- `apps/desktop` — the Electron app (main, renderer, preload)
- `packages/host-service` — the local host service that manages worktrees,
  agent sessions, and the SQLite store in `~/.superset`
- `packages/ui`, `packages/shared`, ... — shared libraries
- `.github/workflows/build-desktop.yml` — the CI pipeline that builds the
  released installers (x64 on `windows-2022`, ARM64 on `windows-11-arm`)

See [`AGENTS.md`](./AGENTS.md) for monorepo conventions.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the PR process and
[`SECURITY.md`](./SECURITY.md) for reporting vulnerabilities.
