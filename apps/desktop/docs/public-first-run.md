# Public Windows first run

Public x64 and ARM64 releases run on this PC without a GatedSpace account. The
account menu says **This PC** and links to **Set up agents**. Old cloud preferences
and stored cloud tokens cannot change the public backend into cloud mode. Personal
builds retain their existing account flow.

The initial screen offers official Codex / Claude Code setup and native provider
sign-in inside an app terminal. Installation runs only when the user chooses Set
up; Sign in alone never installs. Native CLI sign-in uses the provider browser
flow and does not depend on an Electron OAuth callback. A provider account and
network connection are still required for agent work. Installation status is not
represented as authenticated status. Recheck and retry are available.

Public packages include the unmodified, SHA-256-pinned MinGit 2.56.0.2 runtime for
the target CPU. Its original licenses and corresponding-source links ship with it.
The app adds this only to its own process PATH as a fallback; user-installed Git
wins. Official native agent installs in ~/.local/bin are detected without a restart.

Opening a folder prepares local history automatically. This is disclosed on the
setup screen and folder picker. Existing repositories/history are retained. An
empty initial commit uses the user's identity or a command-scoped GatedSpace
identity when none exists; no global Git settings change. Existing files, including
staged files, are never included in that checkpoint. Fresh template projects may
commit the specifically chosen template. Drive roots and the whole home directory
are rejected for automatic initialization.

Verification:
- Real Git tests with empty identity, signing enabled, staged files, and repeated opens.
- Native Electron fixture checks actual setup UI actions and narrow/wide layouts.
- CI runs the actual packaged executable on both architectures with a fresh profile
  and no system Git on PATH. It checks public landing, backend startup, plain-folder
  import, and recovery from the legacy cloud preference.
- Downloaded installers are extracted and checked for architecture, public flags,
  feature markers, bundled Git, GitHub hashes, blockmaps, and update-manifest hashes
  before the draft is published.

Live third-party sign-in needs the user's account and is not simulated by these
checks. Setup commands use the official provider installers:
https://github.com/openai/codex and https://code.claude.com/docs/en/setup.
