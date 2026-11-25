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
 * localStorage so an installed phone app stays paired across launches.
 *
 * NO VOICE. In-app dictation was removed on 2026-08-08: it spent a button in a
 * one-row composer, and it only ever worked over an HTTPS link because the
 * browser speech API needs a secure context — on the default plain-HTTP
 * Tailscale address it hid itself and pointed at the keyboard's dictation key,
 * which is where it should have pointed all along. The desktop still has no
 * audio capture path of any kind.
 */
import { MOBILE_BRIDGE_APP_JS } from "./client-app";
import { MOBILE_BRIDGE_CSS } from "./client-css";
import { MOBILE_BRIDGE_ICON_URL } from "./pwa-assets";

const ICON_SESSIONS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const ICON_TASKS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 2 2 4-4M13 6h8M13 13h8M13 20h8"/><circle cx="5" cy="14" r="2"/><circle cx="5" cy="21" r="1"/></svg>`;
const ICON_MAKE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4 5 5M13 6l5-5 5 5-5 5-7 7-6 1 1-6zM3 6H2v16h16v-2"/></svg>`;
const ICON_PROFILE = `<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#65608b"/><circle cx="16" cy="12" r="5" fill="#e6dff4"/><path d="M7 28v-3a9 9 0 0 1 18 0v3" fill="#e6dff4"/></svg>`;
const ICON_COMPUTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="12" rx="2"/><path d="M2 19h20M9 15v4m6-4v4"/></svg>`;

export const MOBILE_BRIDGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark light" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" type="image/png" sizes="1024x1024" href="${MOBILE_BRIDGE_ICON_URL}" />
<link rel="apple-touch-icon" sizes="1024x1024" href="${MOBILE_BRIDGE_ICON_URL}" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="GatedDuet" />
<meta name="theme-color" content="#0e0e0e" />
<title>GatedDuet</title>
<style>${MOBILE_BRIDGE_CSS}</style>
</head>
<body>
<header>
  <button class="iconbtn" id="space-menu" aria-label="Open conversations"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h16M4 12h16M4 18h12"/></svg></button>
  <button class="iconbtn" id="back" hidden aria-label="Back">‹</button>
  <div class="mobile-brand"><img src="${MOBILE_BRIDGE_ICON_URL}" alt="" /><h1 id="title">GatedDuet</h1></div>
  <span class="ver" id="ver"></span>
  <button class="iconbtn" id="new" hidden aria-label="New session">+</button>
  <button class="iconbtn" id="profile-menu" aria-label="Profile and settings">${ICON_PROFILE}<span class="dot" id="dot"></span></button>
</header>

<p id="connection" class="connection" role="status" hidden></p>
<main id="main"><p class="muted">Loading…</p></main>

<p class="hint" id="hint" role="status" aria-live="polite" hidden></p>

<div id="shelf" hidden></div>

<footer id="composer" hidden>
  <!-- Still image-only, unlike the desktop composer. The bridge sends
       attachments as base64 image blocks and the phone has no filesystem path
       to hand the agent instead, so a PDF picked here would fail after the
       fact rather than at the picker. Opening this up needs an upload endpoint
       on the bridge; until then the filter is the honest answer.
       accept + the camera: the picker offers camera AND gallery, which is what
       "send a screenshot" needs on a phone. multiple, because a bug report is
       rarely one screen. -->
  <input type="file" id="file" accept="image/*" multiple hidden />
  <button id="attach" aria-label="Attach images">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  </button>
  <textarea id="input" aria-label="Message" rows="1" placeholder="Message" enterkeyhint="send"></textarea>
  <!-- An arrow, not the word "Send". On a phone the composer is one row and
       every character of that button is width the prompt does not get. The mic
       that used to sit here is gone for the same reason: the keyboard has its
       own dictation key, which works in more places than ours did. -->
  <button id="stop" aria-label="Stop response" hidden><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg></button>
  <button id="send" aria-label="Send">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
    </svg>
  </button>
</footer>

<div id="mobile-dock">
<nav id="tabs" aria-label="Main navigation" hidden>
  <button data-tab="sessions" class="sel">${ICON_SESSIONS}<span>Chat</span></button>
  <button data-tab="tasks">${ICON_TASKS}<span>Tasks</span></button>
  <button data-tab="make">${ICON_MAKE}<span>Make</span></button>
</nav>
<button id="computer-menu" aria-label="Computers">${ICON_COMPUTER}</button>
</div>

<script>${MOBILE_BRIDGE_APP_JS}</script>
</body>
</html>`;
