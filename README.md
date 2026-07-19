<div align="center">

# GatedSpace

### An agentic development environment for Windows

Run Claude Code, Codex, and any other CLI coding agent in parallel —
each in its own isolated git worktree, with built-in terminals, diff review,
and workspace management.

**Free. No account. No cloud. Everything runs on your machine.**

[**Download for Windows**](https://github.com/yzgershon/GatedSpace/releases/latest) &nbsp;&bull;&nbsp; [Report an issue](https://github.com/yzgershon/GatedSpace/issues)

</div>

---

GatedSpace is a Windows port of [Superset](https://github.com/superset-sh/superset)
(see [NOTICE.md](./NOTICE.md) — this project is not affiliated with Superset, Inc.).
Superset ships for macOS and Linux with a cloud backend; GatedSpace brings the
same agent-orchestration workflow to Windows x64 and ARM64, and runs entirely
locally — no sign-up, no subscription, and every feature unlocked.

## Download

Grab the installer for your PC from the
[latest release](https://github.com/yzgershon/GatedSpace/releases/latest):

| Your PC | Installer |
|---|---|
| Most Windows PCs (Intel or AMD) | `GatedSpace-x64.exe` |
| Windows on ARM (Snapdragon laptops, Surface Pro X, etc.) | `GatedSpace-arm64.exe` |

Not sure which? Open **Settings → System → About** and check **System type**.

### "Windows protected your PC"?

The installers are not code-signed yet, so SmartScreen shows a warning on first
run. Click **More info**, then **Run anyway**. Every installer is built from
this repository's source by GitHub Actions — you can audit the exact build in
the [Actions tab](https://github.com/yzgershon/GatedSpace/actions).

The app auto-updates from this repository's releases after install.

## What it does

- **Parallel agents** — run several Claude Code / Codex / any-CLI-agent
  sessions side by side, each in its own git worktree, so agents never step on
  each other's changes.
- **Workspaces** — one project, many worktrees. Create, switch, and tear down
  branches without touching your main checkout.
- **Built-in terminals** — persistent PTY sessions that survive app restarts.
- **Review before you merge** — built-in diff view for each workspace, then
  open in your editor of choice.
- **Claude account profiles** — optionally declare multiple Claude accounts
  (`~/.superset/claude-profile.json`) and GatedSpace routes new agents to
  whichever one has usage left.
- **Local-only by design** — no account, no analytics keys baked into public
  builds, all data in local SQLite. Your code never leaves your machine.

## Requirements

- Windows 10/11, x64 or ARM64
- [Git](https://git-scm.com/) on your PATH
- The agents you want to run (e.g. [Claude Code](https://docs.anthropic.com/en/docs/claude-code),
  [Codex](https://github.com/openai/codex)) installed and signed in

## Build from source

```bash
git clone https://github.com/yzgershon/GatedSpace.git
cd GatedSpace
bun install
cd apps/desktop
bun run compile:app
bun run package -- --publish never
```

Requires [Bun](https://bun.sh) (see `.bun-version`), Node.js, and on Windows
the Visual Studio 2022 C++ build tools for native modules. Public builds set
`NEXT_PUBLIC_LOCAL_ONLY=1` at compile time to bake in local-only mode.

## Credits & license

GatedSpace is a modified version of [Superset](https://github.com/superset-sh/superset)
by Superset, Inc. — the upstream team deserves the credit for the product
design and the vast majority of the code. This fork adds the Windows port,
the local-only mode, and the rebrand; it is **not affiliated with or endorsed
by Superset, Inc.**

Licensed under the [Elastic License 2.0](./LICENSE.md), same as upstream.
See [NOTICE.md](./NOTICE.md) for details.
