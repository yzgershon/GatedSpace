# Claude clarifying questions

Claude sends its native `AskUserQuestion` through the same stdio
`can_use_tool` control request as tool permissions. It must not use the normal
Allow/Decline card: returning the original input without answers makes Claude
report that the user did not answer.

GatedSpace renders each question with its choices and a text field. Single
choices, multiple choices and custom text require an explicit **Send answer**.
The button remains disabled until every question has an answer. **Dismiss question**
returns a denial without inventing an answer. Normal tool permissions retain
their existing approval controls.

The renderer sends only an answer mapping through `claudeSession.answerPermission`.
The backend validates it against the pending request, retains the original input
(including questions and metadata), and adds `updatedInput.answers`. Keys are
the full question strings; values are option labels or custom text. Multiple
selections are joined with `, `, as supported by
[Claude's input protocol](https://code.claude.com/docs/en/agent-sdk/user-input#response-format).
An empty, partial, malformed or stale response cannot consume a pending question.
Question answers cannot modify other tools' inputs.

This is shared by the personal/public builds and Windows x64/ARM64. Existing
installed builds need an application update to receive the fix.

Questions are inline and never take keyboard focus during rendering. People can
type, paste, attach files and send from other panes while a question is open.
Sending a new direction from the same main composer bypasses the normal outbox:
Claude receives the new message before its outstanding questions are dismissed.
Tool permissions remain pending. Failed sends retain the composer draft.
An explicit **Send now** on a queued message is also allowed while attention is
needed; automatic queue delivery still waits.

Codex offers the same dismiss and composer behavior. Native questions resolve
with an empty `answers` map, following the
[Codex question response handler](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/request_user_input.rs).
GatedSpace asynchronous questions send a dismissal notice without choosing an
answer. When the user writes a new main-composer message, that message steers
the active turn and clears the older questions only after successful delivery.
It never approves a command or an MCP permission. Replies already being sent
are allowed to finish.

From `apps/desktop`:

```sh
bun test src/main/lib/claude-session/permission-requests.test.ts src/shared/claude-session/questions.test.ts
node scripts/check-claude-questions.mjs
node scripts/check-question-interactions.mjs
bun test src/main/lib/codex-session/session-manager.test.ts src/main/lib/session-queue/session-queue.test.ts
```

The browser check connects the production React components to the production
`PermissionRequests` handler through fixture IPC. It covers selections, custom
text, multiple questions, narrow panes, retry, keyboard submission, cancellation,
ordinary approvals and duplicate clicks. It does not prompt a live Claude
account or test an installed application.
