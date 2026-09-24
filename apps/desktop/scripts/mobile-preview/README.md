# Mobile interaction checks

The preview serves the real bundled mobile HTML/CSS/JavaScript with simulated agent APIs, bound only to loopback. It never reads personal sessions or calls an AI provider.

From the repository root, start `bun apps/desktop/scripts/mobile-preview/server.ts`. Then run `node apps/desktop/scripts/mobile-preview/verify.mjs` with `PLAYWRIGHT_MODULE` pointing to the installed Playwright module if it is not resolvable normally. Chrome must be installed. `MOBILE_PREVIEW_PORT` and `MOBILE_PREVIEW_ORIGIN` can override port 52132. Evidence is written under `.tmp/`.

The test covers both providers, pagination, offline recovery, draft persistence, send/navigation races, image-only prompts, question replies, collapsed tools, small screens, reduced motion, and browser errors. This is fixture evidence, not a physical Android or live agent test.

Run manager route and bridge lifecycle tests in separate Bun processes because they mock singleton modules:

- `bun test apps/desktop/src/main/lib/mobile-bridge/session-api.test.ts`
- `bun test apps/desktop/src/main/lib/mobile-bridge/server.lifecycle.test.ts`
