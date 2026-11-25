# Mobile interaction checks

The preview serves the real bundled mobile HTML/CSS/JavaScript with simulated agent APIs, bound only to loopback. It never reads personal sessions or calls an AI provider.

From the repository root, start `bun apps/desktop/scripts/mobile-preview/server.ts`. Then run `node apps/desktop/scripts/mobile-preview/verify.mjs` with `PLAYWRIGHT_MODULE` pointing to the installed Playwright module if it is not resolvable normally. Chrome must be installed. `MOBILE_PREVIEW_PORT` and `MOBILE_PREVIEW_ORIGIN` can override port 52132. Evidence is written under `.tmp/`.

The test covers both providers, pagination, offline recovery, draft persistence, send/navigation races, image-only prompts, question replies, collapsed tools, small screens, reduced motion, and browser errors. This is fixture evidence, not a physical Android or live agent test.

Run `node apps/desktop/scripts/mobile-preview/verify-attachments.mjs` against the same fixture server for photo regressions (Edge required). It covers both providers, camera-size images, same-file reselection, sequential decoding and canvas cleanup, partial failures, read timeouts, canvas-memory fallback, visible errors, and navigation while processing. APIs are simulated; it never sends to a real session. Physical iPhone verification is separate.

Run `node apps/desktop/scripts/mobile-preview/verify-regressions.mjs` for HTTP LAN compatibility (no `crypto.randomUUID`), slow startup, safe Markdown, completion status, question focus/dismissal, tool detail loading, a 20-image shelf at 320px, and a 1,000-message paginated conversation. Receipts and screenshots are in `.tmp/mobile-regressions/`.

Run `node apps/desktop/scripts/mobile-preview/verify-upload-v8.mjs` with Node, not Bun. It bundles the production upload schema and checks 200 KB–5 MB images in V8, the engine Electron actually uses. A repeated-group base64 regex passed Bun/JavaScriptCore tests but overflowed V8's stack on large uploads. This test also checks invalid data and the 20-image limit. Receipts are in `.tmp/mobile-contract-v8/`.

Run manager route and bridge lifecycle tests in separate Bun processes because they mock singleton modules:

- `bun test apps/desktop/src/main/lib/mobile-bridge/session-api.test.ts`
- `bun test apps/desktop/src/main/lib/mobile-bridge/server.lifecycle.test.ts`
