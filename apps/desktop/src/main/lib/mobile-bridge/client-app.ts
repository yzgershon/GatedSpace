/**
 * The phone app's behaviour.
 *
 * Plain ES5-flavoured JS in a string, deliberately: no build step, no bundler,
 * no dependency on the renderer's toolchain, and it keeps working when the
 * thing you are using it to diagnose is the renderer. The tradeoff is that
 * nothing typechecks it, so `client-app.test.ts` compiles it and asserts the
 * behaviours that would otherwise only fail on a device.
 *
 * Four views behind a tab bar — Sessions, Usage, Settings, and the conversation
 * you get to from Sessions. State is three variables and a render call; a
 * framework here would cost more than it saved.
 */
export const MOBILE_BRIDGE_APP_JS = `
// The token comes out of the URL immediately — history and shoulders both keep
// what is in an address bar — and is kept in localStorage.
//
// It used to be sessionStorage, on the reasoning that closing the tab should
// end the session. That is right for a tab and wrong for an APP: an installed
// PWA is closed and reopened constantly, and every reopen landed on "this link
// has expired" with no way back in except fetching the link from the desktop.
// The token is scoped to this origin on the owner's own phone, and the desktop
// can revoke it; making it un-survivable bought nothing and cost the app.
(function () {
  var fromUrl = new URLSearchParams(location.search).get("t");
  if (fromUrl) {
    localStorage.setItem("bridge-token", fromUrl);
    history.replaceState(null, "", location.pathname);
  }
  // One-time carry-over so an already-paired phone doesn't have to re-scan.
  var legacy = sessionStorage.getItem("bridge-token");
  if (legacy && !localStorage.getItem("bridge-token")) {
    localStorage.setItem("bridge-token", legacy);
  }
})();
var TOKEN = localStorage.getItem("bridge-token") || "";

var $ = function (id) { return document.getElementById(id); };
var main = $("main"), title = $("title"), back = $("back"), dot = $("dot");
var composer = $("composer"), input = $("input"), sendBtn = $("send"), tabs = $("tabs");
var newBtn = $("new");
var hint = $("hint");
var attachBtn = $("attach"), fileInput = $("file"), shelf = $("shelf");

$("ver").textContent = "v__PAGE_VERSION__";

var tab = "sessions";      // sessions | usage | settings
var current = null;        // open session key, when reading a conversation
var timer = null;
var eventLimit = 200;      // how much of the open conversation to fetch
var themes = [];
var themeId = localStorage.getItem("gs-theme") || "";

function api(path, options) {
  return fetch("/api" + path, Object.assign(
    { headers: { "x-bridge-token": TOKEN, "content-type": "application/json" } },
    options || {}
  )).then(function (r) {
    if (r.status === 401) {
      // The desktop rotated the token, so what is saved here can only fail from
      // now on. Dropping it means the next tap on a fresh link pairs cleanly
      // rather than being ignored in favour of the dead one.
      localStorage.removeItem("bridge-token");
      throw new Error("This phone is no longer paired. Open the link from GatedSpace again.");
    }
    if (!r.ok) throw new Error("Request failed (" + r.status + ")");
    return r.json();
  });
}

function fail(message) {
  main.innerHTML = "";
  var p = document.createElement("p");
  p.className = "err";
  p.textContent = message;
  main.appendChild(p);
}

/* ---------------------------------------------------------------- theming */

// The desktop's own token names, mapped onto the short ones the stylesheet
// uses. Keeping the mapping here rather than renaming tokens on the server
// means the desktop stays the single source of truth for what a theme IS.
var TOKEN_MAP = {
  "--bg": "background",
  "--fg": "foreground",
  "--card": "card",
  "--border": "border",
  "--muted": "mutedForeground",
  "--accent": "primary",
  "--accent-fg": "primaryForeground",
  "--success": "success",
  "--warning": "warning",
  "--danger": "destructive"
};

function applyTheme(theme) {
  if (!theme || !theme.ui) return;
  var root = document.documentElement;
  for (var cssVar in TOKEN_MAP) {
    var value = theme.ui[TOKEN_MAP[cssVar]];
    if (value) root.style.setProperty(cssVar, value);
  }
  // Keeps the OS status bar and the browser's own chrome in step with the
  // theme, which is most of what makes an installed PWA stop looking like a
  // web page in a costume.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta && theme.ui.background) meta.setAttribute("content", theme.ui.background);
}

function currentTheme() {
  for (var i = 0; i < themes.length; i++) if (themes[i].id === themeId) return themes[i];
  return themes[0];
}

function loadThemes() {
  return api("/themes").then(function (data) {
    themes = data.themes || [];
    applyTheme(currentTheme());
  }).catch(function () { /* fallback palette stays */ });
}

/* ------------------------------------------------------------------ views */

function setTab(next) {
  tab = next;
  current = null;
  clearInterval(timer); timer = null;
  clearInterval(thinkTimer); thinkTimer = null;
  composer.hidden = true;
  back.hidden = true;
  hint.hidden = true;
  // The shelf is fixed to the viewport, not inside the composer, so it has to
  // be dismissed explicitly or it floats over the sessions list.
  pending = [];
  renderShelf();
  // Only the sessions list turns it back on. "+" on the usage screen would be
  // a button that starts work from a screen about not having any left.
  newBtn.hidden = true;
  for (var i = 0; i < tabs.children.length; i++) {
    var b = tabs.children[i];
    b.className = b.dataset.tab === next ? "sel" : "";
  }
  tabs.hidden = false;
  render();
}

function render() {
  if (tab === "sessions") return renderSessions();
  if (tab === "usage") return renderUsage();
  return renderSettings();
}

function sectionHeader(label, count) {
  var wrap = document.createElement("div");
  wrap.className = "sec";
  var h = document.createElement("h2");
  h.textContent = label;
  wrap.appendChild(h);
  if (count != null) {
    var c = document.createElement("span");
    c.className = "count";
    c.textContent = String(count);
    wrap.appendChild(c);
  }
  return wrap;
}

function sessionRow(name, sub, running, onOpen) {
  var row = document.createElement("div");
  row.className = "row";
  var pip = document.createElement("span");
  pip.className = "pip" + (running ? " run" : "");
  var body = document.createElement("div");
  body.className = "body";
  var n = document.createElement("div");
  n.className = "name";
  n.textContent = name;
  var s = document.createElement("div");
  s.className = "sub";
  s.textContent = sub;
  body.appendChild(n); body.appendChild(s);
  row.appendChild(pip); row.appendChild(body);
  if (onOpen) row.onclick = onOpen;
  return row;
}

/* ------------------------------------------------------- starting a session */

/**
 * The picker behind the "+".
 *
 * A workspace is CHOSEN from the list the desktop already has rather than typed
 * as a path: the server only accepts a workspace id, so there is nothing to
 * type that could point somewhere unintended, and nothing to mistype on a phone
 * keyboard either.
 */
function renderNewSession() {
  title.textContent = "New session";
  main.innerHTML = '<p class="muted">Loading…</p>';
  back.hidden = false;
  tabs.hidden = true;
  api("/workspaces").then(function (data) {
    var list = data.workspaces || [];
    main.innerHTML = "";
    if (!list.length) {
      var none = document.createElement("p");
      none.className = "muted";
      none.textContent = "No workspaces open on the desktop.";
      main.appendChild(none);
      return;
    }

    var box = document.createElement("textarea");
    box.className = "newprompt";
    box.rows = 4;
    box.placeholder = "What should it work on?";
    main.appendChild(box);

    main.appendChild(sectionHeader("Where"));
    var chosen = list[0].id;
    var rows = [];
    list.forEach(function (w) {
      var row = sessionRow(w.name, w.project, false, null);
      row.className = "row pick" + (w.id === chosen ? " sel" : "");
      row.onclick = function () {
        chosen = w.id;
        rows.forEach(function (r) { r.className = "row pick"; });
        row.className = "row pick sel";
      };
      rows.push(row);
      main.appendChild(row);
    });

    var go = document.createElement("button");
    go.className = "primary";
    go.textContent = "Start";
    go.onclick = function () {
      var text = box.value.trim();
      if (!text) { box.focus(); return; }
      // Disabled for the whole round trip: a second tap would start a second
      // session, and the first one would be left running with nothing watching
      // it.
      go.disabled = true;
      go.textContent = "Starting…";
      api("/sessions", {
        method: "POST",
        body: JSON.stringify({ workspaceId: chosen, text: text })
      }).then(function (res) {
        openSession(res.key);
      }).catch(function (e) {
        go.disabled = false;
        go.textContent = "Start";
        fail(e.message);
      });
    };
    main.appendChild(go);
  }).catch(function (e) { fail(e.message); });
}

function renderSessions() {
  title.textContent = "Sessions";
  main.innerHTML = '<p class="muted">Loading…</p>';
  newBtn.hidden = false;
  Promise.all([api("/sessions"), api("/history").catch(function () { return { sessions: [] }; })])
    .then(function (results) {
      var live = results[0].sessions || [];
      var past = results[1].sessions || [];
      // A session that is running is shown ONCE, under Active. Without this the
      // same conversation appears in both lists and the counts lie.
      var liveIds = {};
      live.forEach(function (s) { if (s.sessionId) liveIds[s.sessionId] = true; });

      main.innerHTML = "";
      main.appendChild(sectionHeader("Active", live.length));
      if (!live.length) {
        var none = document.createElement("p");
        none.className = "muted";
        none.textContent = "Nothing running right now.";
        main.appendChild(none);
      }
      live.forEach(function (s) {
        main.appendChild(sessionRow(s.title, s.running ? "Running" : "Idle", s.running,
          function () { openSession(s.key); }));
      });

      var shown = past.filter(function (s) { return !liveIds[s.sessionId]; });
      main.appendChild(sectionHeader("History", shown.length));
      if (!shown.length) {
        var e = document.createElement("p");
        e.className = "muted";
        e.textContent = "No past sessions yet.";
        main.appendChild(e);
        return;
      }
      shown.forEach(function (s) {
        main.appendChild(sessionRow(s.title || "Untitled session", relTime(s.modifiedAt || s.updatedAt), false, null));
      });
    })
    .catch(function (e) { fail(e.message); });
}

function relTime(value) {
  if (!value) return "";
  var then = typeof value === "number" ? value : Date.parse(value);
  if (!then) return "";
  var mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

function renderUsage() {
  title.textContent = "Usage";
  main.innerHTML = '<p class="muted">Loading…</p>';
  api("/usage").then(function (data) {
    var accounts = data.accounts || [];
    main.innerHTML = "";
    if (!accounts.length) {
      var e = document.createElement("p");
      e.className = "empty";
      e.textContent = "No Claude accounts configured.";
      main.appendChild(e);
      return;
    }
    accounts.forEach(function (a) { main.appendChild(usageCard(a)); });
  }).catch(function (e) { fail(e.message); });
}

function usageCard(account) {
  var card = document.createElement("div");
  card.className = "acct";

  var top = document.createElement("div");
  top.className = "top";
  var label = document.createElement("div");
  label.className = "label";
  label.textContent = account.label || "Account";
  top.appendChild(label);
  if (account.active) {
    var tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "Active";
    top.appendChild(tag);
  }
  card.appendChild(top);

  // These names are the ones readProfileLimits actually returns. They were
  // sessionPct/weekPct/opusWeekPct — invented here rather than read off the
  // server — so every field was undefined and every account reported "no usage
  // recorded yet" while the desktop showed real numbers. client-html.test.ts
  // now pins them against the server's own output.
  var limits = account.limits || {};
  var windows = [
    { name: "Session", pct: limits.fiveHourPercent, resets: limits.fiveHourResets },
    { name: "Week", pct: limits.weeklyPercent, resets: limits.weeklyResets }
  ].filter(function (w) { return typeof w.pct === "number"; });

  if (!windows.length) {
    var unknown = document.createElement("div");
    unknown.className = "muted";
    // Limits are only known after that account has been used, because they are
    // read from what the CLI last wrote to disk — never fetched.
    unknown.textContent = "No usage recorded yet.";
    card.appendChild(unknown);
    return card;
  }

  windows.forEach(function (w) {
    var row = document.createElement("div");
    row.className = "win";
    var n = document.createElement("span");
    n.textContent = w.name;
    var v = document.createElement("span");
    // The reset value is the CLI's own label ("3pm", "Tue"), not a timestamp,
    // so it is printed as written rather than run through relFuture.
    v.textContent = Math.round(w.pct) + "%" + (w.resets ? " · resets " + w.resets : "");
    row.appendChild(n); row.appendChild(v);
    card.appendChild(row);

    var bar = document.createElement("div");
    bar.className = "bar" + (w.pct >= 90 ? " hot" : w.pct >= 70 ? " warn" : "");
    var fill = document.createElement("i");
    fill.style.width = Math.min(100, Math.max(0, w.pct)) + "%";
    bar.appendChild(fill);
    card.appendChild(bar);
  });

  return card;
}

function relFuture(value) {
  var then = typeof value === "number" ? value : Date.parse(value);
  if (!then) return "";
  var mins = Math.round((then - Date.now()) / 60000);
  if (mins <= 0) return "soon";
  if (mins < 60) return "in " + mins + "m";
  var hours = Math.round(mins / 60);
  if (hours < 24) return "in " + hours + "h";
  return "in " + Math.round(hours / 24) + "d";
}

function renderSettings() {
  title.textContent = "Settings";
  main.innerHTML = "";
  main.appendChild(sectionHeader("Theme"));

  themes.forEach(function (t) {
    var opt = document.createElement("div");
    opt.className = "opt";

    var sw = document.createElement("div");
    sw.className = "swatch";
    [t.ui.background, t.ui.card, t.ui.primary].forEach(function (c) {
      var i = document.createElement("i");
      i.style.background = c;
      i.style.boxShadow = "inset 0 0 0 1px rgba(128,128,128,0.25)";
      sw.appendChild(i);
    });

    var body = document.createElement("div");
    body.className = "body";
    var n = document.createElement("div");
    n.className = "name";
    n.textContent = t.name;
    var s = document.createElement("div");
    s.className = "sub muted";
    s.textContent = t.type === "dark" ? "Dark" : "Light";
    body.appendChild(n); body.appendChild(s);

    opt.appendChild(sw); opt.appendChild(body);
    if (t.id === (currentTheme() || {}).id) {
      var tick = document.createElement("span");
      tick.className = "check";
      tick.textContent = "✓";
      opt.appendChild(tick);
    }
    opt.onclick = function () {
      themeId = t.id;
      localStorage.setItem("gs-theme", t.id);
      applyTheme(t);
      renderSettings();
    };
    main.appendChild(opt);
  });

  main.appendChild(sectionHeader("Account"));
  var accountBox = document.createElement("div");
  accountBox.className = "muted";
  accountBox.textContent = "Loading…";
  main.appendChild(accountBox);
  renderAccounts(accountBox);

  main.appendChild(sectionHeader("Notifications"));
  var status = document.createElement("p");
  status.className = "muted";
  main.appendChild(status);

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    status.textContent = "This browser can't do push notifications.";
    return;
  }
  if (!window.isSecureContext) {
    // Same rule as the microphone: no secure context, no permission. Saying so
    // beats a button that fails with nothing to explain it.
    status.textContent = "Needs the HTTPS link. Switch the bridge to Tailscale HTTPS on the desktop.";
    return;
  }

  if (Notification.permission === "denied") {
    status.textContent = "Blocked. Turn notifications back on for this app in your phone's settings.";
    return;
  }
  if (Notification.permission === "granted" && pushReady) {
    status.textContent = "On. You'll get a notification when an agent finishes or needs you.";
    return;
  }

  status.textContent = "Get a notification when an agent finishes or needs you.";
  var turnOn = document.createElement("button");
  turnOn.className = "primary";
  turnOn.textContent = "Turn on notifications";
  turnOn.onclick = function () {
    turnOn.disabled = true;
    turnOn.textContent = "Asking…";
    enablePush().then(function () {
      renderSettings();
    }).catch(function (e) {
      turnOn.disabled = false;
      turnOn.textContent = "Turn on notifications";
      status.className = "err";
      status.textContent = e.message;
    });
  };
  main.appendChild(turnOn);

  if (isIos() && !window.matchMedia("(display-mode: standalone)").matches) {
    var ios = document.createElement("p");
    ios.className = "muted";
    // iOS refuses push to a page in a browser tab, with no error worth reading.
    // Better to say so up front than let the button fail.
    ios.textContent = "On iPhone you have to add this to your home screen first — Share, then Add to Home Screen — and open it from there.";
    main.appendChild(ios);
  }

  renderConnection();
}

/**
 * Switching which Claude account the next session uses.
 *
 * Sessions already running keep the account they were launched with — their CLI
 * process was started against that config directory and cannot be moved — so
 * this is worded as affecting the NEXT one rather than left to be discovered.
 */
function renderAccounts(box) {
  api("/usage").then(function (data) {
    var accounts = data.accounts || [];
    box.textContent = "";
    box.className = "";
    if (!accounts.length) {
      box.className = "muted";
      box.textContent = "No Claude accounts configured.";
      return;
    }

    // "Auto" is a real option, not an absence of one: it fails over to whichever
    // account still has usage left.
    var options = [{ id: "auto", label: "Auto", sub: "Whichever account has usage left" }];
    accounts.forEach(function (a) {
      options.push({
        id: a.id,
        label: a.label,
        sub: a.ready === false ? "Not signed in" : (a.active ? "In use now" : "Ready")
      });
    });

    options.forEach(function (o) {
      var row = document.createElement("div");
      var chosen = data.mode === o.id || (data.mode !== "auto" && o.id === data.mode);
      row.className = "opt" + (chosen ? " sel" : "");
      var body = document.createElement("div");
      body.className = "body";
      var n = document.createElement("div");
      n.className = "name";
      n.textContent = o.label;
      var sub = document.createElement("div");
      sub.className = "sub muted";
      sub.textContent = o.sub;
      body.appendChild(n); body.appendChild(sub);
      row.appendChild(body);
      if (chosen) {
        var tick = document.createElement("span");
        tick.className = "check";
        tick.textContent = "✓";
        row.appendChild(tick);
      }
      row.onclick = function () {
        api("/accounts/active", {
          method: "POST",
          body: JSON.stringify({ id: o.id })
        }).then(function () {
          renderAccounts(box);
        }).catch(function (e) {
          box.className = "err";
          box.textContent = e.message;
        });
      };
      box.appendChild(row);
    });

    var note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Applies to the next session you start. Sessions already running keep the account they began with.";
    box.appendChild(note);
  }).catch(function (e) {
    box.className = "err";
    box.textContent = e.message;
  });
}

/** What this phone is connected to, and how. Diagnostics, not decoration. */
function renderConnection() {
  main.appendChild(sectionHeader("Connection"));
  var list = document.createElement("div");
  list.className = "facts";
  [
    ["Link", location.host],
    ["Encrypted", window.isSecureContext ? "Yes" : "No — LAN mode"],
    ["Installed", window.matchMedia("(display-mode: standalone)").matches ? "Yes" : "Running in the browser"],
    ["Page", "v__PAGE_VERSION__"]
  ].forEach(function (pair) {
    var row = document.createElement("div");
    row.className = "win";
    var k = document.createElement("span");
    k.textContent = pair[0];
    var v = document.createElement("span");
    v.textContent = pair[1];
    row.appendChild(k); row.appendChild(v);
    list.appendChild(row);
  });
  main.appendChild(list);

  var unpair = document.createElement("button");
  unpair.className = "danger";
  unpair.textContent = "Forget this phone";
  unpair.onclick = function () {
    // Local only: it drops the token this device holds. The desktop is
    // untouched, so another device that is paired stays paired.
    localStorage.removeItem("bridge-token");
    location.reload();
  };
  main.appendChild(unpair);
}

/* ------------------------------------------------------------ notifications */

var pushReady = false;

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function urlBase64ToUint8Array(value) {
  var padded = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  var raw = atob(padded);
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The worker is registered with the token in its URL, because a service worker
 * cannot read this page's sessionStorage and has to keep working while the page
 * is closed — which is precisely when a push arrives.
 */
function registerWorker() {
  return navigator.serviceWorker.register("/sw.js?t=" + encodeURIComponent(TOKEN));
}

function enablePush() {
  return Notification.requestPermission().then(function (permission) {
    if (permission !== "granted") throw new Error("Notifications were not allowed.");
    return registerWorker();
  }).then(function (registration) {
    return navigator.serviceWorker.ready.then(function () { return registration; });
  }).then(function (registration) {
    return api("/push/key").then(function (data) {
      return registration.pushManager.subscribe({
        // Required to be true, and true in fact: every push this sends results
        // in a visible notification.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey)
      });
    });
  }).then(function (subscription) {
    return api("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription.toJSON())
    });
  }).then(function () {
    pushReady = true;
  });
}

/**
 * Re-attach on every load rather than only when the button is pressed.
 *
 * The bridge token changes each time the switch is turned off and on, which
 * leaves the phone holding a worker that can no longer ask what happened. This
 * quietly re-registers it with the current token.
 */
function restorePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (!window.isSecureContext || Notification.permission !== "granted") return;
  registerWorker().then(function (registration) {
    return registration.pushManager.getSubscription().then(function (existing) {
      if (existing) {
        pushReady = true;
        // Re-send it: the desktop's stored list does not survive a reinstall,
        // and the phone is the only side that knows the subscription is live.
        return api("/push/subscribe", {
          method: "POST",
          body: JSON.stringify(existing.toJSON())
        });
      }
      return enablePush();
    });
  }).catch(function () { /* notifications stay off; nothing else breaks */ });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", function (event) {
    if (event.data && event.data.type === "open-session" && event.data.sessionKey) {
      openSession(event.data.sessionKey);
    }
  });
}

/* ---------------------------------------------------------- conversation */

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
  if (!turns.length) return null;
  var frag = document.createDocumentFragment();
  // No cap here. The SERVER decides how much of the conversation to send, and
  // trimming again on this side hid history that had already been fetched —
  // which is what made a long session appear to begin partway through.
  turns.forEach(function (t) {
    var div = document.createElement("div");
    div.className = "turn" + (t.who === "You" ? " you" : "");
    var who = document.createElement("div");
    who.className = "who";
    who.textContent = t.who;
    var pre = document.createElement("pre");
    pre.textContent = t.text;
    div.appendChild(who); div.appendChild(pre);
    frag.appendChild(div);
  });
  return frag;
}

/**
 * How full the conversation's context window is.
 *
 * The number that decides whether to keep going or compact, so it sits at the
 * top of the conversation rather than behind a tab: on a phone, the only reason
 * to check is that you are about to send something.
 */
function contextBar(context) {
  if (!context || !context.contextTokens) return null;
  var window_ = context.contextWindow || 0;
  var wrap = document.createElement("div");
  wrap.className = "ctx";

  var row = document.createElement("div");
  row.className = "win";
  var label = document.createElement("span");
  label.textContent = "Context";
  var value = document.createElement("span");
  var pct = window_ ? Math.round((context.contextTokens / window_) * 100) : null;
  value.textContent = pct === null
    ? formatTokens(context.contextTokens)
    : pct + "% · " + formatTokens(context.contextTokens) + " / " + formatTokens(window_);
  row.appendChild(label); row.appendChild(value);
  wrap.appendChild(row);

  if (pct !== null) {
    // Amber from 70, red from 90 — the same thresholds the desktop uses, so
    // the two never disagree about when it is time to compact.
    var bar = document.createElement("div");
    bar.className = "bar" + (pct >= 90 ? " hot" : pct >= 70 ? " warn" : "");
    var fill = document.createElement("i");
    fill.style.width = Math.min(100, Math.max(0, pct)) + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);
  }
  return wrap;
}

function formatTokens(n) {
  if (!n) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1000000) return (Math.round(n / 100) / 10).toFixed(1) + "k";
  return (Math.round(n / 100000) / 10).toFixed(1) + "M";
}

/*
 * "Still working", phone-sized.
 *
 * The desktop shows a mark, a gerund typing itself in, an elapsed counter and
 * a token count. None of that fits a phone chat pane, and the question being
 * asked here is smaller: is it still going, or has it stopped and I missed it?
 *
 * So: the mark alone, cycling the SAME frames the desktop uses, in the theme
 * accent. One glyph answers the question and costs one line.
 */
var SPINNER_FRAMES = ["·", "✢", "✳", "∗", "✻", "✽"];
var thinkTimer = null;

function thinkingRow() {
  var row = document.createElement("div");
  row.className = "thinking";
  var mark = document.createElement("span");
  mark.className = "mark";
  mark.textContent = SPINNER_FRAMES[0];
  row.appendChild(mark);

  clearInterval(thinkTimer);
  // 120ms is the desktop's cadence, so the two read as the same animation.
  var frame = 0;
  thinkTimer = setInterval(function () {
    // Stop as soon as the row leaves the document, or the interval outlives
    // the render that created it and keeps firing against a detached node.
    if (!mark.isConnected) { clearInterval(thinkTimer); thinkTimer = null; return; }
    frame = (frame + 1) % SPINNER_FRAMES.length;
    mark.textContent = SPINNER_FRAMES[frame];
  }, 120);
  return row;
}

function refresh() {
  if (!current) return;
  api("/sessions/" + encodeURIComponent(current) + "/events?limit=" + eventLimit).then(function (data) {
    dot.className = "dot" + (data.running ? " on" : "");
    var atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
    main.innerHTML = "";

    var ctx = contextBar(data.context);
    if (ctx) main.appendChild(ctx);

    if (data.truncated) {
      // The conversation goes back further than what was sent. Fetching more
      // is a tap rather than automatic: over cellular, silently pulling a
      // megabyte because someone opened a session is not a favour.
      var more = document.createElement("button");
      more.className = "earlier";
      more.textContent = "Show earlier messages";
      more.onclick = function () {
        eventLimit = Math.min(eventLimit * 4, 4000);
        more.disabled = true;
        more.textContent = "Loading…";
        refresh();
      };
      main.appendChild(more);
    }

    var content = renderEvents(data.events);
    if (content) main.appendChild(content);
    else {
      var e = document.createElement("p");
      e.className = "muted";
      e.textContent = "Nothing yet.";
      main.appendChild(e);
    }
    // Driven by "thinking", not "running". The latter means the CLI process is
    // alive, which for a session pane is the entire time it is open — the mark
    // used to pulse forever because of it.
    if (data.thinking) main.appendChild(thinkingRow());
    else { clearInterval(thinkTimer); thinkTimer = null; }
    if (atBottom) window.scrollTo(0, document.body.scrollHeight);
  }).catch(function (e) { fail(e.message); });
}

function openSession(id) {
  current = id;
  // Images staged for one conversation must not follow you into another.
  pending = [];
  renderShelf();
  // Back to the cheap default for each session opened, so one long scroll-back
  // does not make every later session pull its whole history.
  eventLimit = 200;
  title.textContent = "Session";
  back.hidden = false;
  composer.hidden = false;
  tabs.hidden = true;
  newBtn.hidden = true;
  main.innerHTML = '<p class="muted">Loading…</p>';
  refresh();
  clearInterval(timer);
  // Polling, not a socket: a phone that sleeps and wakes reconnects a poll for
  // free, whereas a dropped socket needs reconnect logic for the same result.
  timer = setInterval(refresh, 2500);
}

back.onclick = function () { setTab("sessions"); };
newBtn.onclick = function () { renderNewSession(); };

function send() {
  var text = input.value.trim();
  // An image on its own is a valid message — "look at this" is the whole point
  // of sending a screenshot.
  if ((!text && !pending.length) || !current) return;
  sendBtn.disabled = true;
  var images = pending;
  api("/sessions/" + encodeURIComponent(current) + "/send", {
    method: "POST",
    body: JSON.stringify({ text: text, images: images })
  }).then(function () {
    input.value = "";
    input.style.height = "auto";
    // Cleared only on success. A failed send that emptied the shelf would mean
    // re-picking the screenshots.
    pending = [];
    renderShelf();
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

/* ------------------------------------------------------------ attachments */

/*
 * Screenshots are the reason to drive an agent from a phone at all: the thing
 * you want to show it is already on this screen.
 *
 * Images are DOWNSCALED here rather than sent as they came off the camera. A
 * modern phone photo is 4-8MB, which is slow over cellular and over the size
 * the session will accept anyway; 1600px on the long edge is more than enough
 * for a screenshot to stay readable, and turns a 6MB upload into a few hundred
 * KB.
 */

/** Long edge, in px, after downscaling. Screenshots stay legible well below this. */
var MAX_IMAGE_EDGE = 1600;
/** Enough for a bug report; a guard against selecting an entire camera roll. */
var MAX_ATTACHMENTS = 6;

var pending = [];   // images chosen but not yet sent

function readImage(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);

      // A separate, much smaller render for the chip and the desktop's own
      // transcript. It rides inside the event, which lives for the whole
      // session, so it has to stay tiny.
      var ts = Math.min(1, 160 / Math.max(w, h));
      var thumb = document.createElement("canvas");
      thumb.width = Math.max(1, Math.round(w * ts));
      thumb.height = Math.max(1, Math.round(h * ts));
      thumb.getContext("2d").drawImage(canvas, 0, 0, thumb.width, thumb.height);

      resolve({
        name: file.name || "image.jpg",
        mediaType: "image/jpeg",
        width: w,
        height: h,
        // JPEG regardless of what came in: a PNG screenshot re-encodes to a
        // fraction of the size at a quality no one can tell apart on a phone.
        data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1],
        thumbnail: thumb.toDataURL("image/jpeg", 0.6)
      });
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read " + (file.name || "that image")));
    };
    img.src = url;
  });
}

function renderShelf() {
  shelf.innerHTML = "";
  shelf.hidden = pending.length === 0;
  pending.forEach(function (image, index) {
    var chip = document.createElement("div");
    chip.className = "chip";
    var img = document.createElement("img");
    img.src = image.thumbnail;
    img.alt = image.name;
    var remove = document.createElement("button");
    remove.className = "x";
    remove.setAttribute("aria-label", "Remove " + image.name);
    remove.textContent = "×";
    remove.onclick = function () {
      pending.splice(index, 1);
      renderShelf();
    };
    chip.appendChild(img); chip.appendChild(remove);
    shelf.appendChild(chip);
  });
}

attachBtn.onclick = function () { fileInput.click(); };

fileInput.onchange = function () {
  var files = Array.prototype.slice.call(fileInput.files || []);
  // Reset immediately: without this, picking the same photo twice in a row
  // fires no change event the second time.
  fileInput.value = "";
  if (!files.length) return;

  var room = MAX_ATTACHMENTS - pending.length;
  if (room <= 0) {
    showHint("That is as many images as one message takes.", true);
    return;
  }
  if (files.length > room) {
    showHint("Only the first " + room + " images were added.", true);
  }

  attachBtn.disabled = true;
  Promise.all(files.slice(0, room).map(readImage)).then(function (images) {
    pending = pending.concat(images);
    renderShelf();
  }).catch(function (e) {
    showHint(e.message, true);
  }).then(function () {
    attachBtn.disabled = false;
  });
};

/* ------------------------------------------------------------------- hint */

/*
 * In-app dictation was removed on 2026-08-08.
 *
 * It cost a button in a one-row composer on a phone, which is the most
 * expensive real estate in this app, and it only ever worked over an HTTPS
 * link — the browser speech API needs a secure context, so on a plain-HTTP
 * Tailscale address the button hid itself and the hint pointed at the
 * keyboard's own dictation key anyway. That key works everywhere, in every
 * field, with no permission prompt of ours.
 *
 * showHint stays: the attachment code uses it. (No backticks in this file's
 * comments — the whole script is a template literal, so one ends the string.)
 */

function showHint(message, warn) {
  hint.textContent = message;
  hint.className = warn ? "hint warn" : "hint";
  hint.hidden = false;
}

/* ------------------------------------------------------------------- boot */

for (var i = 0; i < tabs.children.length; i++) {
  (function (btn) {
    btn.onclick = function () { setTab(btn.dataset.tab); };
  })(tabs.children[i]);
}

/**
 * Tapping a notification while the app is CLOSED opens it at a #session= hash
 * rather than delivering a message, because there is no page yet to receive
 * one. Read once and cleared, so a later reload does not reopen it.
 */
function sessionFromHash() {
  var match = /#session=([^&]+)/.exec(location.hash || "");
  if (!match) return null;
  history.replaceState(null, "", location.pathname);
  try { return decodeURIComponent(match[1]); } catch (e) { return null; }
}

if (!TOKEN) fail("Open this page using the link from GatedSpace.");
else loadThemes().then(function () {
  var wanted = sessionFromHash();
  setTab("sessions");
  if (wanted) openSession(wanted);
  restorePush();
});
`;
