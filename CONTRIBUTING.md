# Contributing to GatedSpace

Thanks for wanting to help. For anything beyond a small fix, please open an
[issue](https://github.com/yzgershon/GatedSpace/issues) first so we can discuss
the change before you invest time in it.

There is a [code of conduct](./CODE_OF_CONDUCT.md); please follow it in all
your interactions with the project.

## Local development setup

See [**DEVELOPMENT.md**](./DEVELOPMENT.md) for the full guide. Short version:

```bash
bun install
cd apps/desktop
bun run dev
```

On Windows you also need the Visual Studio 2022 C++ build tools (for native
modules) and [Git](https://git-scm.com/) on your PATH. No cloud credentials are
required; public builds run fully local.

## Before you open a PR

1. Format and lint: `bun x biome check .` must come back clean. The lint
   pipeline fails on any diagnostic, including warnings.
2. Typecheck: `bun run typecheck --filter='!electric-proxy'`.
3. Tests: `bun run test`. Heads up if you develop on Windows: a number of
   upstream tests assume Unix (symlinks, socket paths, `/Users` paths) and fail
   locally while passing in CI. Judge your run against CI, not a local zero.

## Pull request process

1. [Fork the repo](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo)
   and create a branch from `main`.
2. Make your changes and [open a PR from your fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork).
   Describe what changed and link the related issue.
3. Check **Allow edits from maintainers** so the PR can be updated during
   review.
4. CI must be green before merge.

One note on history: the public `main` branch is a curated release history.
Merged contributions are applied to the internal development branch and ship in
the next release; your PR and commits stay visible on GitHub either way.

## Style

The codebase is formatted and linted by [Biome](https://biomejs.dev) (tabs,
double quotes; see `biome.jsonc`). Match the style of the code around you and
leave things cleaner than you found them.
