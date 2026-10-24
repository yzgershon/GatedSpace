# Claude session auto-compaction

GatedSpace's native Claude panes run Claude Code in persistent stream-json mode.
Claude Code owns automatic compaction and continues the active turn from its
summary. GatedSpace must not interrupt that turn, send a second `/compact` prompt,
or inject a new "continue" message. Terminal Claude sessions use the same native
settings mechanism.

To enable a 250,000-token auto-compaction window for every model in an account,
merge these fields into that account's `settings.json`:

```json
{
  "autoCompactEnabled": true,
  "env": {
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "250000",
    "DISABLE_AUTO_COMPACT": "0",
    "DISABLE_COMPACT": "0"
  }
}
```

Each account has its own configuration directory. Discover GatedSpace accounts
through `listClaudeProfiles()`; include the default `~/.claude` directory as well.
Back up the original settings privately and preserve every unrelated key, hook,
permission, and environment value. This is a personal preference, not a hardcoded
override for everyone installing GatedSpace. New accounts need their own setting.

The environment window overrides per-model window settings and `/autocompact`.
Change this value to adjust the window; remove it to return control to Claude's
model settings. Claude reserves space for compaction and respects a model's lower
context limit, so 250k is a window, not an exact token-count trigger. A summary is
not a verbatim copy of context, and a smaller window does not guarantee a particular
reduction in subscription usage.

Verification on Claude Code 2.1.300: `/autocompact` reported a 250k window and
compaction enabled for all three configured accounts. A separate persistent
stream-json process picked up a settings-file change from 300k to 250k without a
restart. These local-command checks reported zero model cost; they did not force a
real 250k-token compaction or measure savings. Existing conversations were not
restarted or sent test prompts.

References: [auto-compact window](https://code.claude.com/docs/en/model-config#set-the-auto-compact-window),
[settings environment and reload behavior](https://code.claude.com/docs/en/env-vars#set-variables-in-settings-files),
[what survives compaction](https://code.claude.com/docs/en/context-window#what-survives-compaction).
