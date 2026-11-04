# Claude compaction controls

Settings → Agents → Claude Code offers **Claude default**, **Custom context
window** (100,000–1,000,000 tokens), and **Off**. The custom input uses thousands
of tokens: 500 means 500,000. For a 1M-context model, 500k is a reasonable starting
point when a 250k window compacts too often. Claude caps the window at the model's
limit and reserves summary headroom. Raising it is not a guaranteed usage saving.

Saving applies the choice to all locally registered accounts and the default
Claude directory, including terminal sessions. Newly added accounts inherit an
explicitly saved choice. Merely opening settings does not change anything.
Different existing account/model preferences are shown as mixed.

The service uses Claude Code's settings-file mechanism, not a second scheduler.
It writes `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `DISABLE_AUTO_COMPACT`, and related
compaction keys, preserving other environment values, permissions and hooks.
It clears per-model windows and stale percentage overrides so the global choice
is consistent. Default uses an empty environment value to clear a prior window
in a running CLI; simply deleting the key would leave the old environment value
in that process. Off keeps manual `/compact` available.

All files are validated before writes. Replacements are atomic, backups are
private, and a failed multi-account save rolls back completed writes. An invalid
settings file is reported rather than overwritten. Project, launch and managed
overrides can still take precedence. The application does not bypass them or
restart running conversations when a preference is saved.

Native stream-json Claude sessions have a circuit breaker: three distinct
automatic `compact_boundary` events in ten minutes stop that process, preserve
the transcript/session ID and replay buffer, mark the session as an error (which
pauses queued delivery), and explain how to adjust the setting and reopen it.
Manual compactions and subagent boundaries are excluded. Late events cannot
mark the stopped turn successful or drain queued messages. This protection does
not observe standalone terminal Claude processes.

Validation includes file persistence/rollback tests, simulated protocol events
through the real session manager, and the production settings component with
mocked IPC in Edge. A local `/autocompact` query on Claude Code 2.1.300 confirmed
500k with zero reported model cost. These checks do not reproduce a real
250k-token provider compaction or establish packaged-installer behavior.

An isolated persistent CLI also picked up 500k → 750k → model default from
settings-file changes without restarting, with zero reported model cost.

The reported Flock loop had another concrete cause: the workspace's 382 KB
historical `HANDOFF.md` was reattached as nested project memory after each
compaction. The local file was reduced to current state and its full history
archived privately. Repository instructions now cap the imported handoff at
12 KB and keep historical archives out of automatic imports. Existing loaded
context may still need a manual `/compact` to discard that old material.

References: [window and precedence](https://code.claude.com/docs/en/model-config#set-the-auto-compact-window),
[environment and settings reload](https://code.claude.com/docs/en/env-vars#set-variables-in-settings-files).
