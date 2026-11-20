# First-run setup

New Windows installations open a four-step guide inside the normal GatedSpace
workspace. This also runs in public, local-only builds; their local identity does
not count as a connected GatedSpace account.

1. **Account:** use the existing Continuity browser/device-code flow to create or
   connect a GatedSpace account with Google or GitHub. The user approves the device
   in the browser. Local-only use remains available, and project sync remains off
   until separately configured.
2. **Agents:** install the official native Codex or Claude Code tool if missing,
   require an account nickname, and complete the provider's browser authorization.
   Continue becomes available after the selected tool and account are verified.
3. **Project:** choose a local folder through the existing folder-first import
   flow. It reuses existing projects and creates local version history when needed;
   a GitHub account is not required.
4. **First session:** highlight the actual agent launcher, its Session pane menu
   item, and the conversation composer. The guide never submits a prompt or grants
   tool permissions on the user's behalf.

Progress is stored per device in `gatedspace:first-run:v1`. A restart resumes the
saved step and workspace. Existing workspaces or a previously viewed workspace
prevent automatic onboarding. A failed workspace query is not treated as an empty
installation. **Getting started** in the profile menu reopens the guide; **Finish
setup later** leaves a resume button. Release highlights wait until setup ends.

## Agent installation and sign-in

`main/lib/agent-install.ts` owns cancellable installation jobs, using the fixed
official PowerShell endpoints. It verifies native executable discovery and
`--version` before reporting success. Runtime path discovery happens in the app,
so newly installed tools do not require restarting GatedSpace. Installation does
not run an interactive agent or change approval settings.

`agent-setup-status.ts` checks the selected profile using the provider's own auth
status command. It separates "installed" from "connected". Setup is also available
in agent settings, account sign-in, and failed session panes.

Codex retains its app-server browser flow. Claude uses its native `auth login`
process and verifies `auth status --json` afterward. If automatic browser launch
fails, the same pending login can reopen its approved provider URL. When Claude
asks for a browser code, a password input forwards it only to that pending
process. Codes are not persisted or logged. Canceling, closing, or timing out the
login stops its owned helper; late callbacks cannot mark it connected.

## Computer control runtime

After a user enables Computer control, missing prerequisites are prepared inside
GatedSpace. `main/lib/computer-use/runtime.ts` reuses an existing `uvx` or downloads
the architecture-matched uv archive to the app's private runtime directory. The
version and SHA-256 hashes are pinned. Downloads are bounded, verified before
extraction, and published only after both executables are present. Partial
installs can be retried without replacing a user's tools.

The existing Windows-MCP backend then prepares its Python environment. Progress
appears in the pane and overlay. Stop aborts setup and prevents a late connection
from gaining control. Existing pane-scoped consent and tool restrictions remain
in force. No machine-wide PATH edit or app restart is required.

## Verification

Public Account settings uses the actual GatedSpace connection and native agent
accounts. The stable local user/organization IDs remain internal database
ownership keys; they are not an editable cloud profile. Connecting or disconnecting
GatedSpace does not change those IDs or sign the user out of Claude or Codex.
The sidebar shows the connected account email, or **This PC** while disconnected.

Local project import, reopening, worktree creation/adoption, and workspace renaming
must not call the disabled Superset cloud API. Regression coverage lives in
`packages/host-service/test/integration/project-local.integration.test.ts` and
`packages/host-service/test/workspace-cloud-sync.test.ts`. The public release smoke
test also verifies guided onboarding without a cloud account and the Account
settings surface in the actual packaged app.

From `apps/desktop`:

```powershell
bun test src/main/lib/agent-install.test.ts src/main/lib/agent-accounts/claude-login.test.ts src/main/lib/agent-accounts/service.test.ts src/main/lib/computer-use/runtime.test.ts src/main/lib/computer-use/service.test.ts src/renderer/components/FirstRunSetup/state.test.ts
bun x tsc --noEmit
```

Before a release, exercise a clean profile on both packaged Windows architectures:

- Account creation, existing-account sign-in, browser reopening, and local-only use.
- Each missing native agent: install, cancel, retry, nickname, browser authorization,
  and verified connection. For Claude, also test its code fallback when offered.
- Folder import failure/retry and a successful first Session pane. Restart halfway
  through setup, then confirm that resuming opens the same workspace.
- Keyboard navigation and a narrow window; coach marks must remain on-screen.
- Computer control with no global uv/Python installation: progress, Stop during
  download, retry, then tool discovery only under the user's existing grant.
- An existing profile must open normally, with the tour available from its menu.

Component/browser checks with mocked IPC do not establish live provider OAuth or
packaged clean-install success. Real download/extraction checks are likewise
separate from granting computer control or starting a live agent conversation.
