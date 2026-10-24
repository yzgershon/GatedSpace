# Flock

Flock is a local collaborative workspace for real Codex and Claude Code sessions.
It lives inside the desktop dashboard. A coordinator owns the outcome; members can
send contributions directly to each other, disagree, publish artifacts and review
specific revisions. Conversations keep their native session identities and tools.

## Product flow

Open the Flock network icon in the sidebar navigation. Mission → Roster → Launch
collects the brief, definition of done, working folder, optional references and
team. Pair, Balanced and Full team presets are starting points; responsibilities
remain editable. Either provider can be coordinator. Select an existing conversation
or create a dedicated one. New conversations are provisioned only on Save draft
or Launch. No messages are sent when saving a draft.

The active workspace contains the coordinator and roster, actual handoffs, an
exchange journal, tasks, decisions and shared work. Clicking a member opens its
native conversation. Clicking a handoff opens the corresponding exchange.
Artifact revisions retain their individual reviews. The group composer addresses
the coordinator, a member, or everyone. Pause holds new deliveries while allowing
current turns to finish; Resume continues held responses. Stop cancels queued
messages and attempts to interrupt only turns attributable to this group.

The compact toolbar, single scrolling setup region and fixed setup actions adapt
useful ideas from BridgeSpace's Swarm roster and launch flow. GatedSpace's existing
Dracula tokens, provider identities, dashboard shell and controls remain in use.
There is no additional app sidebar or marketing header inside this feature.
Reference: https://docs.bridgemind.ai/docs/code-mode (inspected 2026-10-22), plus the
user's open Swarm desktop UI. No third-party code was copied.

## Architecture and delivery guarantees

- `shared/ensemble.ts`: validated group and final-response protocol. The internal
  `ensemble` protocol marker remains stable; the product's name is Flock.
- `main/lib/ensemble/engine.ts`: provider-independent durable outbox and state
  machine. Sender identity comes from the recipient's correlated native turn,
  not a model-provided sender field. Whole action batches validate on a clone
  before committing; an invalid batch cannot partially send messages.
- `native-transport.ts`: uses the existing managers, never another CLI resume
  process. Codex replies require a completed matching native turn and exclude
  commentary. Claude replies require a top-level terminal result, exclude child
  agent output, and use the manager's actual busy/permission state.
- `storage.ts`: atomic JSON replacement under the owner-only application data
  directory. Corrupt/unsupported files fail visibly and remain untouched. Groups,
  goals, messages, decisions, references and artifact versions survive restarts.
- `service.ts` and the `ensemble` tRPC router: lazy native service, event-driven
  scheduling, subscriptions and a five-second active-work backstop.
- `renderer/components/EnsembleWorkspace`: the same React UI is used in the
  application route and development demonstration. The native route opens or
  focuses the original pane key through the workspace collection.

Each delivery has a UUID and persists before transmission. `queued` means waiting
to send; `delivered` means the native API accepted it; `answered` means a correlated
completed turn returned. These are distinct from the member's live working/input
state. A lost transport response or restart produces `uncertain`, pauses the group,
and requires inspection before an explicit requeue with a new UUID. This is
conservative recovery, not a claim of exactly-once provider execution.

Busy sessions and permission prompts hold deliveries. A user turn inserted into a
member's conversation is never mistaken for a group reply. Peer messages are
visibly labeled and their prompt wrapper explicitly separates them from user
instructions or permission grants. Native Codex sends retain model, effort and
the session's selected permission setting. Flock does not approve tools or change
provider permissions. The protocol itself runs no arbitrary shell commands.

The public role is Coordinator. The persisted `commanderId` and creation input
`commanderIndex` retain their wire names so existing groups remain readable. Prior
conversation text and journal entries are preserved.

The coordinator can assign tasks, record decisions and complete. Members can update
their own tasks and publish or review artifacts. Completion requires all tasks
done, no outstanding deliveries, and an independent review of the current artifact
revision. The coordinator must explain the result. This validates the process, not
the truth or quality of the generated work; reviews remain inspectable. A turn
that schedules nothing and produces no final result pauses visibly for direction.

## Scope and practical limits

- 2–6 active members; 1–3 concurrent turns; default 24 deliveries, configurable
  from 4 to 100. A finite budget stops recursive discussion. Counts are actual
  deliveries; no estimated dollars or invented token totals are shown.
- Turns in the same normalized working directory are serialized within a group.
  Use existing worktrees for parallel edits. This does not lock external editors
  or unrelated sessions and does not create, merge or clean worktrees automatically.
- A session cannot run in two groups at once. A paused group's unfinished or
  uncertain deliveries retain ownership until resolved.
- Up to four text/Markdown/CSV/JSON references, each at most 12,000 characters.
  They are copied into this group's durable context. Artifacts are versioned text,
  with Markdown export. Remote images are not fetched while rendering artifacts.
- Native open sessions are connectable. Closed historical conversations must first
  be opened in GatedSpace. Coordinator replacement and restarting ended groups are
  deferred; start a new group with the desired existing conversations instead.
- The store currently supports 40 groups and a 25 MB journal. Archiving/export of
  whole groups, richer artifact integrations, measured provider costs, automatic
  worktree management and remote teams are follow-on work.

## Existing connection improvements

The essay workspace's CONNECTION.md and PROTOCOL.md describe a peer-led experiment:
authenticated local messages, manual polling, explicit identity checks and shared
files. Those conversations were active during inspection, so their work and
relationship were preserved. Dedicated real sessions provided the isolated test.

The underlying mobile session API now reports Claude's actual busy state instead
of replay-derived activity, rejects sending while busy or awaiting approval, and
preserves explicitly restricted Codex permissions. Flock adds durable queuing,
correlation, shared context and automatic handoffs on top of the native managers.
These source changes benefit the existing connection after a later authorized
release; the installed application was not replaced or restarted during this work.

## Verification evidence (2026-10-22)

**Live providers:** a real Codex coordinator and real Claude reviewer completed the
fictional Borrowed tool-library launch brief. Five deliveries, two artifact
revisions, two independent reviews and two completed tasks are recorded. Claude
challenged enrollment, return timing, demand and host/insurance assumptions in v1.
Codex revised the brief, explained an alternative to one recommendation, requested
another review, and completed only after Claude recorded READY against v2.
Pause/resume held the initial handoff while the Codex turn finished. Claude's
existing one-time naming permission stopped progress until the user explicitly
approved that exact action; it was then approved and the workflow continued.
Communication worked in both directions. The original essay sessions were untouched.

**Fixtures/unit checks:** queue ordering, busy and approval gates, restart ambiguity,
lost responses, identity changes, unrelated user turns, atomic action batches,
directory serialization, completion review, stop ownership, budgets, no-handoff
pausing, disk-write failure and snapshot compatibility. Native-manager fixtures
verify completed-turn correlation and permission preservation. The mobile API has
regressions for busy Claude sends and restricted Codex sessions.

**UI checks:** headless Edge exercised the real completed run's exchanges, native
transcript read and revision-bound reviews, plus 320/600/900/1440 px layouts and
keyboard view switching. Isolated HTTP fixtures exercised setup/reference payloads,
provider/coordinator selection, pause/resume, user-direction submission and reduced
motion. Those fixture controls sent zero provider messages. Evidence is in
`.tmp/flock-verification/report.json` and screenshots in the same folder.

The live development bridge runs the same engine and UI against the installed
app's authenticated local API. It is scoped to dedicated test sessions, discovers
the port, keeps the token server-side, and uses loopback/Host/Origin/cookie checks.
The production integration directly uses native managers and tRPC. A packaged
desktop smoke test, x64/ARM64 validation and a live Claude-commanded run have **not**
been performed. No installer, publication or main-app restart belongs to this change.

## Developer commands

Run from `apps/desktop` with the repository's Bun on PATH:

```powershell
bun test src/main/lib/ensemble/engine.test.ts src/main/lib/ensemble/native-transport.test.ts src/main/lib/ensemble/storage.test.ts
bun test src/main/lib/mobile-bridge/session-api.test.ts
bun run typecheck
bun run scripts/ensemble-preview/serve.ts
```

The preview restores its private `.tmp/ensemble-live` journal. Only the explicit
`--seed-live` flag creates the bounded test group on an empty journal. Creating
sessions through this bridge is real; its UI labels the live connection. To rebuild
UI assets without interrupting a running workflow, use `build.ts`. Run
`node scripts/ensemble-preview/verify.cjs` after a completed Borrowed demo for the
read-only live-result checks and isolated fixture UI checks. Tests must not share
one Bun invocation with unrelated suites that mock the native managers differently.

Follow the existing commit-first release process only when a later installer or
publication is explicitly requested.
