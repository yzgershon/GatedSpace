# Continue after an account usage limit

Claude and Codex usage stops stay red, including after the conversation has been viewed. A limit is distinct from a completed turn, a provider retry, or an account setup problem.

The recovery card offers **Continue session** and **Auto-continue at reset**. Each opens a small, non-modal explanation before sending or scheduling. Continue sends a new request to pick up the existing work; it preserves the conversation, account, model, effort and permission settings. It does not replay the original request or erase the transcript.

Automatic continuation is opt-in for that incident. Its main-process timer uses the provider's reset timestamp, considering exhausted weekly windows too. It sends once, one second after the reported reset. Unknown reset times remain unscheduled. A failed or quota-rejected continuation is shown for review and is never retried in a loop.

Keep GatedSpace running. Switching tabs does not cancel the schedule; sleeping delays execution until the computer wakes. Cancel, Stop, sending another message, switching accounts, closing the session, or quitting the app cancels it. The schedule is not persisted across application restarts. Reconnecting Claude refuses to silently fork or start a new conversation if its original transcript is unavailable or another pane owns it.

## Verification

- `bun test src/main/lib/usage-recovery/usage-recovery.test.ts` covers timing, sleep, cancellation, duplicate clicks and failure races.
- Provider tests: `src/main/lib/codex-session/session-manager.test.ts` and `src/main/lib/claude-session/usage-recovery.test.ts` (run in separate Bun processes because the Claude fixture mocks native dependencies).
- `node scripts/check-usage-recovery.mjs` runs the actual renderer controls and provider adapters in isolated Chrome fixtures. It checks explanation/confirmation, opt-in/cancel, other-pane typing/pasting/sending, Escape, unknown resets and narrow widths. No real prompts or account changes occur. It generates a durable preview in `.tmp/usage-recovery-preview` at the repository root.
