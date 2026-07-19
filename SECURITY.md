# Security Policy

## Supported versions

Only the [latest release](https://github.com/yzgershon/GatedSpace/releases/latest)
receives fixes. The app auto-updates, so staying current is automatic.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Instead, use
GitHub's private reporting:

**[Report a vulnerability](https://github.com/yzgershon/GatedSpace/security/advisories/new)**

Include what you found, how to reproduce it, and what impact you think it has.
You'll get a response as soon as possible, normally within a few days.

## Scope

GatedSpace runs entirely on your machine. Public builds have no accounts, no
telemetry, and no cloud backend, so the interesting surface is local:

- the installer and auto-update path (releases on this repository)
- the Electron app itself (renderer/main process boundaries, protocol handler)
- the local host service and its SQLite data in `~/.superset`

Vulnerabilities in the coding agents themselves (Claude Code, Codex, Gemini,
etc.) should go to their own projects.
