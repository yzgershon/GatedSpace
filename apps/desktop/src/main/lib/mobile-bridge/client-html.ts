/**
 * The page the phone loads.
 *
 * A single inlined string rather than a bundled app: it has no build step, no
 * dependency on the renderer's toolchain, and it must keep working when the
 * thing it is used to diagnose is the renderer. Small enough to read in one
 * sitting, which for something that accepts a token is a feature.
 *
 * The token is read from the URL and then REMOVED from the address bar, so it
 * does not sit in browser history or get shoulder-read. It lives in
 * sessionStorage, not localStorage: closing the tab should end the session, and
 * a phone that gets picked up an hour later should not still be authenticated.
 *
 * VOICE runs entirely on the phone. The microphone is the phone's, the
 * recognition is the phone's browser, and only text crosses the network — the
 * desktop never sees audio and there is no capture path on it to attack.
 *
 * That does mean a browser rule applies: `SpeechRecognition` requires a SECURE
 * CONTEXT, and `http://192.168.x.x` is not one. Over plain HTTP the button is
 * hidden and the page points at the keyboard's own mic key, which works
 * everywhere and needs nothing from us. Serving over HTTPS is what lights it up.
 */
export const MOBILE_BRIDGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<title>GatedSpace</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; background: #0e0e0e; color: #ededed;
    font: 15px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  header {
    padding: 14px 16px; border-bottom: 1px solid #232323;
    display: flex; align-items: center; gap: 10px;
    position: sticky; top: 0; background: #0e0e0e; z-index: 2;
  }
  h1 { font-size: 15px; margin: 0; font-weight: 600; flex: 1; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #3f3f3f; }
  .dot.on { background: #4ade80; }
  main { padding: 12px 16px 108px; }
  .row {
    padding: 13px 14px; border: 1px solid #232323; border-radius: 10px;
    margin-bottom: 8px; background: #151515;
  }
  .row:active { background: #1c1c1c; }
  .muted { color: #8f8f8f; font-size: 13px; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
  .turn { padding: 10px 0; border-bottom: 1px solid #1c1c1c; }
  .who { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8f8f8f; margin-bottom: 3px; }
  .you .who { color: #d97757; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }
  footer {
    position: fixed; left: 0; right: 0; bottom: 0; background: #0e0e0e;
    border-top: 1px solid #232323; padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    display: flex; gap: 8px;
  }
  textarea {
    flex: 1; resize: none; background: #151515; color: inherit;
    border: 1px solid #2c2c2c; border-radius: 9px; padding: 10px 12px;
    font: inherit; min-height: 42px; max-height: 140px;
  }
  button {
    background: #ededed; color: #0e0e0e; border: 0; border-radius: 9px;
    padding: 0 16px; font: inherit; font-weight: 600; min-height: 42px;
  }
  button:disabled { opacity: .4; }
  .back { background: none; color: #8f8f8f; padding: 0; min-height: auto; font-weight: 400; }
  .err { color: #f87171; padding: 12px 0; }
  /* Square so it reads as an icon control next to the wider Send. */
  #mic {
    background: #151515; color: #ededed; border: 1px solid #2c2c2c;
    padding: 0; width: 42px; display: flex; align-items: center; justify-content: center;
  }
  #mic.on { background: #d94b4b; border-color: #d94b4b; color: #fff; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .62; } }
  /* Sits above the composer rather than inside it, so a long message does not
     push it off screen. */
  .hint {
    position: fixed; left: 0; right: 0; bottom: calc(62px + env(safe-area-inset-bottom));
    padding: 6px 14px; font-size: 12px; color: #8f8f8f; background: #0e0e0e;
  }
  .hint.warn { color: #d9a44b; }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <h1 id="title">Sessions</h1>
  <button class="back" id="back" hidden>Back</button>
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

<script>
// Take the token out of the URL immediately: history and shoulders both keep
// what is in an address bar. sessionStorage, not localStorage — closing the tab
// should end the session.
(function () {
  var fromUrl = new URLSearchParams(location.search).get("t");
  if (fromUrl) {
    sessionStorage.setItem("bridge-token", fromUrl);
    history.replaceState(null, "", location.pathname);
  }
})();
var TOKEN = sessionStorage.getItem("bridge-token") || "";

var main = document.getElementById("main");
var title = document.getElementById("title");
var back = document.getElementById("back");
var dot = document.getElementById("dot");
var composer = document.getElementById("composer");
var input = document.getElementById("input");
var sendBtn = document.getElementById("send");
var current = null;
var timer = null;

function api(path, options) {
  return fetch("/api" + path, Object.assign({ headers: { "x-bridge-token": TOKEN, "content-type": "application/json" } }, options || {}))
    .then(function (r) {
      if (r.status === 401) throw new Error("This link has expired. Re-open it from GatedSpace.");
      if (!r.ok) throw new Error("Request failed (" + r.status + ")");
      return r.json();
    });
}

function fail(message) {
  main.innerHTML = '<p class="err"></p>';
  main.firstChild.textContent = message;
}

function showSessions() {
  current = null;
  composer.hidden = true;
  back.hidden = true;
  title.textContent = "Sessions";
  api("/sessions").then(function (data) {
    if (!data.sessions.length) {
      main.innerHTML = '<p class="muted">No sessions are running.</p>';
      return;
    }
    main.innerHTML = "";
    data.sessions.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "row";
      row.innerHTML = '<div></div><div class="muted"></div>';
      row.firstChild.textContent = s.title;
      row.lastChild.textContent = s.running ? "running" : "stopped";
      row.onclick = function () { openSession(s.key); };
      main.appendChild(row);
    });
  }).catch(function (e) { fail(e.message); });
}

// Only the shapes worth reading on a phone. Tool calls and stream deltas are
// noise at this size — the question being answered is "what is it saying".
function renderEvents(events) {
  var turns = [];
  events.forEach(function (ev) {
    if (ev.type === "local_user_message") {
      turns.push({ who: "You", text: ev.text || "" });
    } else if (ev.type === "assistant" && ev.message && ev.message.content) {
      var text = ev.message.content
        .filter(function (b) { return b.type === "text"; })
        .map(function (b) { return b.text; })
        .join("");
      if (text.trim()) turns.push({ who: "Claude", text: text });
    } else if (ev.type === "user" && typeof (ev.message || {}).content === "string") {
      turns.push({ who: "You", text: ev.message.content });
    }
  });
  if (!turns.length) return '<p class="muted">Nothing yet.</p>';
  return turns.slice(-40).map(function (t) {
    var div = document.createElement("div");
    div.className = "turn" + (t.who === "You" ? " you" : "");
    div.innerHTML = '<div class="who"></div><pre></pre>';
    div.firstChild.textContent = t.who;
    div.lastChild.textContent = t.text;
    return div.outerHTML;
  }).join("");
}

function refresh() {
  if (!current) return;
  api("/sessions/" + encodeURIComponent(current) + "/events").then(function (data) {
    dot.className = "dot" + (data.running ? " on" : "");
    var atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
    main.innerHTML = renderEvents(data.events);
    if (atBottom) window.scrollTo(0, document.body.scrollHeight);
  }).catch(function (e) { fail(e.message); });
}

function openSession(id) {
  current = id;
  title.textContent = "Session";
  back.hidden = false;
  composer.hidden = false;
  main.innerHTML = '<p class="muted">Loading…</p>';
  refresh();
  clearInterval(timer);
  // Polling, not a socket: a phone that sleeps and wakes reconnects a poll for
  // free, whereas a dropped socket needs reconnect logic to get the same result.
  timer = setInterval(refresh, 2500);
}

back.onclick = function () {
  stopMic();
  clearInterval(timer);
  timer = null;
  showSessions();
};

function send() {
  var text = input.value.trim();
  if (!text || !current) return;
  // Dictation NEVER sends by itself. This drives an agent that runs shell
  // commands, and a recogniser that hears "delete" for "commit" should cost a
  // glance at the box, not a turn.
  stopMic();
  sendBtn.disabled = true;
  api("/sessions/" + encodeURIComponent(current) + "/send", {
    method: "POST",
    body: JSON.stringify({ text: text })
  }).then(function () {
    input.value = "";
    input.style.height = "auto";
    setTimeout(refresh, 300);
  }).catch(function (e) { fail(e.message); })
    .then(function () { sendBtn.disabled = false; });
}

sendBtn.onclick = send;

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
}
input.addEventListener("input", autosize);

/* ---------------------------------------------------------------------------
 * Voice, entirely on this device.
 *
 * Nothing is routed to the desktop: the phone's own recogniser turns speech
 * into text in this page, and the text goes out over the same /send endpoint a
 * typed prompt uses.
 * ------------------------------------------------------------------------- */
var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
var micBtn = document.getElementById("mic");
var hint = document.getElementById("hint");
var recog = null;
var listening = false;
// What was already in the box when dictation started.
var baseText = "";
// Finished text from EARLIER recogniser sessions in this dictation. The
// recogniser is restarted whenever the browser times it out (see onend), and a
// restart resets event.results, so anything already finished has to be kept
// here or it would be lost on the next restart.
var committedText = "";
// Finished text from the CURRENT session, recomputed from scratch on every
// event rather than accumulated. See onresult for why that matters.
var sessionText = "";

function showHint(message, warn) {
  hint.textContent = message;
  hint.className = warn ? "hint warn" : "hint";
  hint.hidden = false;
}

if (!SR) {
  // Firefox on Android, and any browser without the API at all.
  showHint("No in-app voice here. Use the mic key on your keyboard.");
} else if (!window.isSecureContext) {
  // The common case on the default LAN link: browsers refuse microphone access
  // on plain HTTP. Naming the cause beats a button that fails when tapped.
  showHint("Voice needs an HTTPS link. Use your keyboard's mic key for now.");
} else {
  micBtn.hidden = false;
  micBtn.onclick = function () {
    if (listening) stopMic();
    else startMic();
  };
}

function startMic() {
  recog = new SR();
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = navigator.language || "en-US";

  // Dictation APPENDS. Typing half a prompt and speaking the rest is a normal
  // thing to want, and clobbering what is already in the box to "start clean"
  // is only ever a surprise.
  baseText = input.value ? input.value.replace(/\\s+$/, "") + " " : "";
  committedText = "";
  sessionText = "";

  recog.onresult = function (event) {
    // REBUILD from index 0 every time; never accumulate.
    //
    // event.results is cumulative for the session, and event.resultIndex is
    // only a hint about what changed — Safari and Chrome frequently report it
    // as 0 on every event. Reading from resultIndex and appending with += then
    // re-appends words that were already finished, once per event, which is
    // why every word came out repeated ("hello hello hello"). Recomputing the
    // whole string is idempotent, so it cannot double-count no matter what the
    // browser reports.
    var finals = "";
    var interim = "";
    for (var i = 0; i < event.results.length; i++) {
      var result = event.results[i];
      if (result.isFinal) finals += result[0].transcript;
      else interim += result[0].transcript;
    }
    sessionText = finals;
    // Interim text lands in the box as you speak, so a misheard word is
    // visible immediately rather than at the end of a long sentence.
    input.value = baseText + committedText + finals + interim;
    autosize();
  };

  recog.onerror = function (event) {
    // Silence is not a failure — onend restarts below.
    if (event.error === "no-speech" || event.error === "aborted") return;
    showHint(
      event.error === "not-allowed"
        ? "Microphone blocked. Allow it for this site in your browser settings."
        : "Voice input stopped (" + event.error + ")",
      true
    );
    stopMic();
  };

  recog.onend = function () {
    // Mobile browsers end a session after a short pause. Without this, thinking
    // mid-sentence ends the dictation and the button silently goes cold.
    if (!listening) return;
    // Bank this session's finished text before restarting: the new session
    // starts with an empty event.results, so anything not moved here would be
    // rebuilt away by the first onresult of the next session.
    committedText += sessionText;
    sessionText = "";
    try { recog.start(); } catch (e) { stopMic(); }
  };

  try {
    recog.start();
  } catch (e) {
    showHint("Could not start voice input.", true);
    return;
  }
  listening = true;
  hint.hidden = true;
  micBtn.classList.add("on");
  micBtn.setAttribute("aria-pressed", "true");
}

function stopMic() {
  // Cleared FIRST so the onend handler above does not restart what we are
  // deliberately stopping.
  listening = false;
  micBtn.classList.remove("on");
  micBtn.setAttribute("aria-pressed", "false");
  if (!recog) return;
  try { recog.stop(); } catch (e) {}
  recog = null;
}

if (!TOKEN) fail("Open this page using the link from GatedSpace.");
else showSessions();
</script>
</body>
</html>`;
