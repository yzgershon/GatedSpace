# Reliable startup, account connections, and mobile sessions

## Requested outcome

Recover reliably after Windows restarts, make account sign-in understandable and functional when configured, support Claude and Codex from the phone, and establish the path for continuing work across laptop and OMEN.

## Evidence from the initial audit

- Personal desktop points to a local API and depends on a separately launched Docker/application stack. Launcher logs record repeated data-service startup timeouts after restarts.
- Local sign-in retries have no individual fetch deadline. Session recovery uses cloud-oriented backoff up to five minutes even for loopback services.
- OAuth buttons are always displayed and their mutation result is ignored. The existing source describes the local provider setup as placeholders; configuration must be checked without exposing secrets. Account identity does not replicate local transcripts or project files.
- The actual phone app is the bundled web app in `main/lib/mobile-bridge`, not the absent upstream Expo app. It only calls the Claude manager.
- Phone history rows cannot be opened. Polls fully replace the conversation DOM and can arrive after navigation. Connection failures erase the transcript; switching sessions discards drafts and staged attachments. Requests lack cancellation and duplicate-send protection.
- The bridge restores once, so a network/Tailscale interface that appears late at boot leaves it offline. Sessions already have separate desktop managers and need a shared, provider-aware remote contract.

## Implementation and verification

1. Fix local startup/recovery, bound network requests, report service versus account errors, and preserve stored authentication and workspace identity.
2. Validate OAuth availability server-side, report failures in the desktop, and verify Windows return-to-app handling. Real provider credentials and hosted account infrastructure cannot be fabricated.
3. Add provider-aware mobile session listing, transcript reading, creation/resume, send, stop, history loading, and question/approval responses using existing managers.
4. Improve mobile navigation, readable activity, image previews, search/filtering, per-session drafts, connection recovery, and reduced-motion/keyboard layouts. Keep authentication required and existing pairing intact.
5. Resolve cross-device requirements with the user: remote access to a running host versus independent continuation with project and conversation synchronization.
6. Exercise failure/retry/race cases and both providers with unit/integration tests plus actual production mobile UI in the sidebar. Package only verified changes; distinguish fixture, installed, and multi-device evidence.

## Confirmed decisions

- Phone is an Android installed PWA through Tailscale HTTPS. Keep existing pairing and private connectivity.
- OMEN must continue independently when the laptop is off, even without both PCs online together.
- User chose a private hosted sync service, not direct Tailscale peer synchronization.
- The owner approved a new dedicated free-plan Vercel service, Neon database and private Blob storage. CLI authentication works even though the connector returned no teams.
- The owner approved initial schema setup on an isolated Neon branch, followed by the dedicated database after verification. The owner also approved dedicated Google/GitHub identity-only OAuth apps and the private email allowlist.

## Packaged local changes

- Repeated sidebar selection keeps the selected panel open; migration recovers the hidden state once.
- Personal startup recovery launches only the known checkout's existing service launcher; no app restart. Missing Docker data services are repaired, and readiness checks contact the database. Network attempts are bounded.
- OAuth provider configuration is checked before opening a browser; errors reach the UI. Current local provider IDs are placeholders. Real Google/GitHub sign-in is not verified or enabled by these changes.
- Mobile Claude/Codex shared routes, saved-session resume, workspace creation, transcript pagination, image previews, question/approval replies, and stop controls. Per-session drafts, duplicate-send guard, navigation generation checks, offline recovery, provider filters/search, and Codex usage with actual provider window labels.
- Bridge restore retries late Tailscale availability, deduplicates startup, and honors shutdown during startup.
- Personal 1.18.23 was built and verified: packaged source/style hashes, installer architecture and update discovery passed. The installer was not executed by the agent. Public remains 1.18.22.

## Hosted continuity implementation boundary

Account authentication alone cannot synchronize provider transcripts or project files. The installed Codex protocol supports resuming a local rollout path (marked unstable), but its in-memory history import is explicitly reserved for Codex Cloud. Do not use that import or mirror a live SQLite database. A tested rollout adapter plus per-PC folder mapping is required. Claude stores are per-profile and per-working-directory.

Prepare a dedicated private hosted account/snapshot service with durable storage, encryption, revision checks, and single-writer handoff. Each PC retains its own provider login. Only explicitly selected projects/sessions are transferred; exclude credentials and ignored/private files. Do not upload the broad C:/Dev tree. Conflicting offline edits must remain recoverable instead of last-write-wins overwrites. Hosting/OAuth registration and a real two-PC continuation test remain prerequisites before calling sync complete.

## Verification so far

- Mobile browser fixture: 18 checks across 390px/320px layouts, both providers, delayed send, navigation, reload drafts, images, Other answers, pagination and offline failures.
- Manager HTTP routes: 7 tests, real router with simulated managers.
- Bridge lifecycle: 3 tests using real loopback listeners and simulated Tailscale; no pairing/security settings changed.
- Launcher AST/mocked-service verification: missing services recovered, healthy services left alone.
- Personal installer contents and update discovery passed. Real OAuth browser sign-in is now verified below. Physical Android, cold reboot, and OMEN hosted sync remain installation checks.


## Account and deployment requirements

The account service needs a stable HTTPS API/web origin, persistent PostgreSQL, and real Google/GitHub OAuth applications with callbacks registered to that API origin. Existing local IDs are placeholders, not failed user credentials. Do not paste OAuth secrets into chat; configure them through the host's secret settings. New desktop callbacks are validated on both connect and success paths, Windows uses the running app's loopback receiver, expired state is rejected, and token-bearing deep links are no longer logged.

A dedicated private hosted service is deployed as an explicitly labeled setup preview. It has Neon and private Blob storage, an email allowlist, client-side encrypted checkpoint transport, revision checks, expiring writer leases, account isolation and quota enforcement. The generated eleven-table schema passed real Postgres checks on an isolated branch before being applied to the new dedicated database, under explicit authorization. No transcript or project data has been uploaded.

Dedicated Google and GitHub OAuth applications are created with exact callbacks. The owner explicitly approved secure credential transfer into this service's encrypted Vercel environment. Both credentials are stored in the dedicated encrypted Vercel environment. Real Google and GitHub browser sign-in succeeded and linked to one verified approved account. The service's health, authorization and no-store headers passed live verification. Never place secret values in tool arguments or logs.

The desktop transfer workflow is now implemented: OS-protected recovery-key/token storage, device-code account connection, encrypted upload queue and durable receipts, native session adapters, bounded Git project collection/restore, per-PC path mapping and conflict recovery. Native Codex parent histories are flattened before legacy replay; native Claude imported messages passed a loopback-model check. A two-profile integration test passed independent continuation and divergence recovery. Actual settings components passed nine browser checks, including 980/560/360px layouts; Windows encryption and owner-only ACLs passed. A live private Blob synthetic round trip passed. The combined Sync/settings suite passed 38 tests with 185 assertions.

Packaging the combined change is next. The prior 1.18.23 personal installer contains only the local startup/sidebar/mobile work. No real project/transcript has been uploaded. Storage remains bounded (1 GiB per account, retained snapshots, no automatic garbage collection); physical OMEN continuation is not yet verified.

## September 24 live startup regression

After a battery shutdown, Docker and the data containers were healthy but the
Windows PowerShell 5.1 readiness probe returned a null exit code. The launcher
never started the application services. A direct Process launch now retains the
exit code, drains output asynchronously and enforces a deadline. Seven checks
passed in Windows PowerShell 5.1, and the owner confirmed access was restored
without resetting any database or session. This repair is included in 1.18.24.
