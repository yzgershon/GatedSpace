/**
 * The page the phone loads.
 *
 * Assembled from three strings rather than one: markup here, styles in
 * `client-css.ts`, behaviour in `client-app.ts`. It grew from one view to four
 * and a single template string had stopped being something anyone would read
 * twice.
 *
 * Still no build step, deliberately. It has no dependency on the renderer's
 * toolchain and keeps working when the thing being diagnosed IS the renderer.
 * The cost is that nothing typechecks it, which is why the tests compile the
 * script and assert its behaviour rather than trusting it.
 *
 * The token is read from the URL and then REMOVED from the address bar, so it
 * does not sit in browser history or get shoulder-read. It lives in
 * sessionStorage, not localStorage: closing the tab should end the session.
 *
 * VOICE runs entirely on the phone — its microphone, its recogniser, and only
 * text crosses the network. The desktop never sees audio and has no capture
 * path to attack. `SpeechRecognition` needs a SECURE CONTEXT, so over plain
 * HTTP the button hides itself and the page points at the keyboard's mic key.
 */
import { MOBILE_BRIDGE_APP_JS } from "./client-app";
import { MOBILE_BRIDGE_CSS } from "./client-css";

const ICON_SESSIONS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const ICON_USAGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>`;
const ICON_SETTINGS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

export const MOBILE_BRIDGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark light" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icon.svg" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="GatedSpace" />
<meta name="theme-color" content="#0e0e0e" />
<title>GatedSpace</title>
<style>${MOBILE_BRIDGE_CSS}</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <h1 id="title">Sessions</h1>
  <span class="ver" id="ver"></span>
  <button class="iconbtn" id="back" hidden aria-label="Back">Back</button>
  <button class="iconbtn" id="new" hidden aria-label="New session">+</button>
</header>

<main id="main"><p class="muted">Loading…</p></main>

<p class="hint" id="hint" hidden></p>

<footer id="composer" hidden>
  <textarea id="input" rows="1" placeholder="Send a prompt…" enterkeyhint="send"></textarea>
  <button id="mic" aria-label="Dictate" aria-pressed="false" hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>
    </svg>
  </button>
  <button id="send">Send</button>
</footer>

<nav id="tabs" hidden>
  <button data-tab="sessions" class="sel">${ICON_SESSIONS}<span>Sessions</span></button>
  <button data-tab="usage">${ICON_USAGE}<span>Usage</span></button>
  <button data-tab="settings">${ICON_SETTINGS}<span>Settings</span></button>
</nav>

<script>${MOBILE_BRIDGE_APP_JS}</script>
</body>
</html>`;
