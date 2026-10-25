# Agent accounts

The profile menu's **Swap account** opens a provider picker for Claude Code and
Codex. Each new account needs a unique nickname (within its provider). **Add
account** runs the provider CLI's browser sign-in and reports Connected only
after the CLI verifies the account. Cancelling or closing the form terminates
that login helper; it does not sign out another account.

For Codex, choose **New Codex sessions** or a named open conversation before
selecting an account. `/swap` and the pane's account popover open the picker for
that conversation. A working turn or pending approval must finish or be stopped
before switching. The switch preserves the thread ID, history, model, effort,
permissions, workspace association and composer draft. It does not submit a
prompt. Other conversations retain their accounts. The usage bar follows the
focused conversation's account.

Claude's existing inline `/swap` continues to move an open conversation; the
profile menu chooses the default for new Claude sessions. Both entry points use
the same nickname-and-browser form when adding an account.

## Storage and connection ownership

- `~/.superset/codex-accounts/profiles.json` stores nicknames, the new-session
  default and thread/account bindings. It contains no credentials. Older,
  unbound conversations retain the original Codex account.
- Each added Codex profile has a private home below that directory. Browser
  login uses `account/login/start` with `chatgpt` and file credential storage in
  that home. API-key environment overrides are removed from these helpers.
- Conversation connections keep the normal Codex home for settings, skills and
  transcripts. One app-server connection per account receives process-local
  `chatgptAuthTokens`; switching never rewrites the normal home's saved login.
- CLI-managed credential renewal is shared across simultaneous requests for an
  account. Tokens remain in the main process and are never returned to the
  renderer. Credential directories/files use the Windows-aware secure-file
  helpers.
- RPC approvals and notifications are scoped to their originating connection.
  A failed switch detaches the new connection and resumes the original thread.
  Closing a pane waits for its in-flight switch and then closes that connection.
- Claude retains its existing profile registry and per-account config folders.
  Adding a profile creates a fresh private folder and runs `claude auth login
  --claudeai`; `claude auth status --json` verifies completion.

Existing credentialed profiles are not overwritten by the Add account flow.
If a saved login becomes unusable, connect an account under a new nickname and
switch the conversation to it. No session transcript is deleted.

## Image attachments and browser pointer

Desktop Codex and Claude composers accept 20 images per message, up to 5 MiB
each, with the same validation for direct and queued sends. Empty MIME metadata
from Windows screenshots falls back to the image extension. The 200 KB limit
is for text attachments. Claude retains its existing image downscaling.
Previously saved queues remain readable for editing or removal; a legacy image
over the new limit must be replaced before sending.

The sidebar pointer is a reusable, pointer-events-free shadow overlay. Its
metallic arrow is painted with the post-action snapshot, removing a separate
JavaScript evaluation. It neither moves Windows input nor changes provider
settings. It has no animation loop and removes itself after 1.6 seconds idle.

## Verification boundary

Regression tests cover account bindings across restarts, busy/approval guards,
rollback, closing during switching, approval-ID collisions, login verification
and cancellation, attachment limits and queue recovery. Browser fixture checks
exercise the actual React components and cursor with simulated account API
responses, including narrow layouts and input pass-through. An isolated native
Codex CLI protocol probe verified process-local external authentication without
writing `auth.json`; it used synthetic credentials and made no model request.

A real second-account browser sign-in and a model turn under each real account
remain release verification steps. Unit/fixture results do not establish that
live-provider coverage or packaged installer readiness.
