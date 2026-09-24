/** Session UI shared by the Android/iOS web app. Uses only text/DOM APIs for transcripts. */
export const MOBILE_SESSION_CLIENT_JS = `
var currentProvider = "claude", viewGeneration = 0, refreshBusy = false;
var historyMessages = [], lastSnapshot = "", sessionData = null;
var drafts = {}, draftRequests = {}, sending = {}, sessionFilter = "all";
var initialScroll = false;
var stopBtn = $("stop"), connection = $("connection");

function sessionPath() { return "/mobile/" + currentProvider + "/" + encodeURIComponent(current); }
function draftKey() { return currentProvider + ":" + current; }
function saveDraft() {
  if (!current) return;
  drafts[draftKey()] = { text: input.value, images: pending.slice() };
  try { localStorage.setItem("gs-draft:" + draftKey(), input.value); } catch (_) {}
}
function restoreDraft() {
  var saved = drafts[draftKey()];
  if (!saved) { var text = ""; try { text = localStorage.getItem("gs-draft:" + draftKey()) || ""; } catch (_) {} saved = {text:text, images:[]}; }
  input.value = saved.text; pending = saved.images.slice(); autosize(); renderShelf();
  sendBtn.disabled = !!sending[draftKey()];
}
function networkMessage(text) { connection.textContent = text; connection.hidden = !text; }
function createButton(text, action, className) {
  var button = document.createElement("button"); button.type = "button";
  button.textContent = text; button.className = className || ""; button.onclick = action; return button;
}
function renderNewSession() {
  saveDraft(); current = null; viewGeneration++; clearInterval(timer); timer = null;
  var generation = viewGeneration;
  title.textContent = "New session"; newBtn.hidden = true; back.hidden = false; tabs.hidden = true;
  composer.hidden = true; shelf.hidden = true; main.replaceChildren();
  var label = document.createElement("p"); label.className = "muted"; label.textContent = "Choose an agent and a workspace on this computer."; main.appendChild(label);
  var provider = document.createElement("select"); provider.setAttribute("aria-label", "Agent");
  ["claude", "codex"].forEach(function (name) { var option = document.createElement("option"); option.value = name; option.textContent = name === "codex" ? "Codex" : "Claude"; provider.appendChild(option); });
  main.appendChild(provider);
  api("/workspaces").then(function (data) {
    if (generation !== viewGeneration) return;
    var list = data.workspaces || [];
    if (!list.length) { fail("Open a workspace on the desktop first, then return here."); return; }
    var workspace = document.createElement("select"); workspace.setAttribute("aria-label", "Workspace");
    list.forEach(function (w) { var option = document.createElement("option"); option.value = w.id; option.textContent = w.project + " · " + w.name; workspace.appendChild(option); });
    main.appendChild(workspace);
    var requestId = crypto.randomUUID();
    var go = createButton("Create session", function () {
      go.disabled = true;
      api("/mobile/new", {method:"POST", body:JSON.stringify({provider:provider.value, workspaceId:workspace.value, requestId:requestId})})
        .then(function (res) { if (generation === viewGeneration) openSession(res.key, res.provider); })
        .catch(function (e) { if (generation === viewGeneration) fail(e.message); })
        .finally(function () { go.disabled = false; });
    }, "primary");
    provider.onchange = workspace.onchange = function () { requestId = crypto.randomUUID(); };
    main.appendChild(go);
  }).catch(function (e) { if (generation === viewGeneration) fail(e.message); });
}
function renderSessions() {
  var generation = viewGeneration;
  title.textContent = "Sessions"; main.replaceChildren(); newBtn.hidden = false;
  var intro = document.createElement("p"); intro.className = "muted"; intro.textContent = "Your desktop, within reach."; main.appendChild(intro);
  var search = document.createElement("input"); search.type = "search"; search.placeholder = "Find a conversation"; search.setAttribute("aria-label", "Search sessions"); main.appendChild(search);
  var filters = document.createElement("div"); filters.className = "agent-filters"; main.appendChild(filters);
  var result = document.createElement("div"); main.appendChild(result);
  var loaded = null;
  function draw() {
    if (!loaded) return;
    result.replaceChildren();
    var liveIds = {};
    loaded.sessions.forEach(function (s) { liveIds[s.provider + ":" + s.sessionId] = true; });
    function matches(s) { return (sessionFilter === "all" || s.provider === sessionFilter) && (s.title + " " + (s.cwd || "")).toLowerCase().includes(search.value.toLowerCase()); }
    function row(s, live) {
      var providerName = s.provider === "codex" ? "Codex" : "Claude";
      var item = sessionRow(s.title || providerName + " session", providerName + " · " + (live ? "Open on desktop" : "Saved conversation"), s.running, function () {
        if (live) { openSession(s.key, s.provider); return; }
        item.disabled = true;
        if (!s.resumeRequestId) s.resumeRequestId = crypto.randomUUID();
        api("/mobile/resume", {method:"POST", body:JSON.stringify({provider:s.provider, sessionId:s.sessionId, requestId:s.resumeRequestId})})
          .then(function (res) { if (generation === viewGeneration) openSession(res.key, res.provider); })
          .catch(function (e) { if (generation === viewGeneration) fail(e.message); })
          .finally(function () { item.disabled = false; });
      });
      item.dataset.provider = s.provider; result.appendChild(item);
    }
    var live = loaded.sessions.filter(matches), past = loaded.history.filter(function (s) { return !liveIds[s.provider + ":" + s.sessionId] && matches(s); });
    result.appendChild(sectionHeader("Open sessions", live.length)); live.forEach(function (s) { row(s, true); });
    result.appendChild(sectionHeader("Recent history", past.length)); past.forEach(function (s) { row(s, false); });
    if (!live.length && !past.length) { var empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No matching conversations."; result.appendChild(empty); }
  }
  ["all", "claude", "codex"].forEach(function (name) {
    var button = createButton(name === "all" ? "All agents" : name === "codex" ? "Codex" : "Claude", function () {
      sessionFilter = name; Array.from(filters.children).forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); }); draw();
    }); button.setAttribute("aria-pressed", String(name === sessionFilter)); filters.appendChild(button);
  });
  search.oninput = draw;
  function load() { api("/mobile/sessions").then(function (data) {
    if (generation !== viewGeneration) return;
    loaded = data; draw(); networkMessage((data.warnings || []).join(" "));
    if (data.historyLoading) setTimeout(function () { if (generation === viewGeneration) load(); }, 3000);
  }).catch(function (e) { if (generation === viewGeneration) fail(e.message); }); }
  load();
}
function showImage(source, name) {
  if (!/^data:image\\/(png|jpeg|webp|gif);base64,|^https:\\/\\//i.test(source)) return;
  var dialog = document.createElement("dialog"); dialog.className = "image-dialog";
  var close = createButton("Close image", function () { dialog.close(); });
  var image = document.createElement("img"); image.alt = name; image.src = source;
  dialog.append(close, image); dialog.onclose = function () { dialog.remove(); }; document.body.appendChild(dialog); dialog.showModal();
}
function renderMessage(item) {
  var node = document.createElement(item.kind === "activity" ? "details" : "article");
  node.dataset.message = item.id; node.className = "turn " + (item.kind === "user" ? "you" : item.kind);
  if (item.kind === "activity") {
    var summary = document.createElement("summary"); summary.textContent = item.title || "Used a tool"; node.appendChild(summary);
  } else {
    var who = document.createElement("div"); who.className = "who";
    who.textContent = item.kind === "user" ? "You" : currentProvider === "codex" ? "Codex" : "Claude"; node.appendChild(who);
  }
  if (item.images && item.images.length) {
    var images = document.createElement("div"); images.className = "message-images";
    item.images.forEach(function (attachment) {
      var button = createButton(attachment.source ? "" : attachment.name, function () {
        if (attachment.source) { showImage(attachment.source, attachment.name); return; }
        if (attachment.index == null) { showHint("This older transcript did not retain the image preview.", true); return; }
        button.disabled = true;
        api(sessionPath() + "/image/" + encodeURIComponent(item.id) + "/" + attachment.index)
          .then(function (data) { showImage(data.source, data.name); }).catch(function (e) { fail(e.message); }).finally(function () { button.disabled = false; });
      }); button.setAttribute("aria-label", "View " + attachment.name);
      if (attachment.source && /^(data:image\\/(png|jpeg|webp|gif);base64,|https:\\/\\/)/i.test(attachment.source)) {
        var img = document.createElement("img"); img.src = attachment.source; img.alt = attachment.name; img.loading = "lazy"; button.appendChild(img);
      }
      images.appendChild(button);
    }); node.appendChild(images);
  }
  var text = document.createElement(item.kind === "activity" ? "pre" : "div"); text.className = "message-text"; text.textContent = item.text; node.appendChild(text);
  return node;
}
function renderQuestions(questions, target) {
  questions.forEach(function (request) {
    var card = document.createElement("section"); card.className = "question-card";
    var heading = document.createElement("h2"); heading.textContent = request.title; card.appendChild(heading);
    var answers = {}, fields = request.questions || [], path = sessionPath(), generation = viewGeneration;
    function answer(allow) {
      if (card.dataset.sending) return;
      card.dataset.sending = "true";
      card.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
      api(path + "/answer", {method:"POST", body:JSON.stringify({id:request.id, allow:allow, answers:answers})})
        .then(function () { if (generation === viewGeneration) { card.remove(); lastSnapshot = ""; refresh(); } })
        .catch(function (e) { if (generation === viewGeneration) { fail(e.message); delete card.dataset.sending; card.querySelectorAll("button").forEach(function (b) { b.disabled = false; }); } });
    }
    function maybeAnswer() { if (fields.every(function (q) { return answers[q.id] && answers[q.id].trim(); })) answer(true); }
    fields.forEach(function (q) {
      var label = document.createElement("p"); label.textContent = q.question; card.appendChild(label);
      (q.options || []).forEach(function (option) {
        var choice = createButton(option, function (event) {
          answers[q.id] = option; card.querySelectorAll("[data-question]").forEach(function(b) { if (b.dataset.question === q.id) b.setAttribute("aria-pressed", "false"); }); event.currentTarget.setAttribute("aria-pressed", "true"); maybeAnswer();
        }, "answer-choice"); choice.dataset.question = q.id; card.appendChild(choice);
      });
      var other = document.createElement("input"); other.type = q.secret ? "password" : "text"; other.placeholder = "Your response"; other.setAttribute("aria-label", "Other: " + q.question);
      var details = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Other";
      details.append(summary, other, createButton("Send response", function () { answers[q.id] = other.value; maybeAnswer(); })); card.appendChild(details);
    });
    if (!fields.length) {
      var detail = document.createElement("pre"); detail.textContent = request.detail || ""; card.appendChild(detail);
      card.append(createButton("Allow once", function () { answer(true); }), createButton("Decline", function () { answer(false); }));
    }
    target.appendChild(card);
  });
}
function thinkingRow() {
  var row = document.createElement("div"); row.className = "thinking-word"; row.setAttribute("role", "status"); row.textContent = "Working"; return row;
}
function drawConversation(data, prepend) {
  var oldHeight = document.documentElement.scrollHeight, oldY = window.scrollY;
  var atBottom = initialScroll || window.innerHeight + oldY >= oldHeight - 100;
  var existingQuestions = main.querySelector(".questions");
  var preserveQuestions = existingQuestions && existingQuestions.dataset.signature === JSON.stringify(data.questions || []);
  var openDetails = Array.from(main.querySelectorAll("details[open][data-message]")).map(function (d) { return d.dataset.message; });
  var combined = [], seen = {};
  historyMessages.concat(data.messages).forEach(function (m) { if (!seen[m.id]) { combined.push(m); seen[m.id] = true; } else { combined[combined.findIndex(function (old) { return old.id === m.id; })] = m; } });
  var oldNodes = new Map(Array.from(main.querySelectorAll("[data-message]")).map(function(node) { return [node.dataset.message, node]; }));
  var nodes = [];
  var ctx = contextBar(data.context); if (ctx) nodes.push(ctx);
  if (data.hasEarlier || historyMessages.length) {
    if (historyMessages.hasEarlier !== false) nodes.push(createButton("Load earlier messages", function (event) {
      var button = event.currentTarget, generation = viewGeneration; button.disabled = true;
      api(sessionPath() + "?before=" + encodeURIComponent(combined[0].id)).then(function (page) {
        if (generation !== viewGeneration) return;
        historyMessages = page.messages.concat(combined); historyMessages.hasEarlier = page.hasEarlier;
        drawConversation(data, true);
      }).catch(function (e) { if (generation === viewGeneration) { button.disabled = false; fail(e.message); } });
    }, "earlier"));
  }
  combined.forEach(function (item) {
    var signature = JSON.stringify(item), node = oldNodes.get(item.id);
    if (!node || node.dataset.signature !== signature) { node = renderMessage(item); node.dataset.signature = signature; }
    if (openDetails.includes(item.id)) node.open = true;
    nodes.push(node);
  });
  if (!combined.length) { var empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "Ready when you are. Send the first message below."; nodes.push(empty); }
  if (data.working) nodes.push(thinkingRow());
  var questions = document.createElement("div"); questions.className = "questions";
  if (preserveQuestions) questions = existingQuestions;
  else renderQuestions(data.questions || [], questions);
  questions.dataset.signature = JSON.stringify(data.questions || []);
  nodes.push(questions);
  if (data.error) { var error = document.createElement("p"); error.className = "err"; error.textContent = data.error; nodes.push(error); }
  nodes.forEach(function(node, index) { if (main.children[index] !== node) main.insertBefore(node, main.children[index] || null); });
  while (main.children.length > nodes.length) main.lastElementChild.remove();
  stopBtn.hidden = !data.working;
  dot.className = "dot" + (data.working ? " on" : "");
  dot.setAttribute("aria-label", data.working ? "Agent working" : "Agent ready");
  if (prepend) window.scrollTo(0, oldY + document.documentElement.scrollHeight - oldHeight);
  else if (atBottom) window.scrollTo(0, document.documentElement.scrollHeight);
  initialScroll = false;
  var hasEarlier = historyMessages.hasEarlier;
  historyMessages = combined.slice(0, Math.max(0, combined.length - data.messages.length));
  historyMessages.hasEarlier = hasEarlier;
}
function refresh() {
  if (!current || refreshBusy || document.hidden) return;
  var generation = viewGeneration, path = sessionPath(); refreshBusy = true;
  api(path).then(function (data) {
    if (generation !== viewGeneration) return;
    networkMessage(""); sessionData = data;
    var snapshot = JSON.stringify(data);
    if (snapshot !== lastSnapshot) { drawConversation(data, false); lastSnapshot = snapshot; }
  }).catch(function (e) { if (generation === viewGeneration) networkMessage(e.message + " Reconnecting…"); })
    .finally(function () { if (generation === viewGeneration) refreshBusy = false; });
}
function openSession(id, provider) {
  saveDraft(); current = id; currentProvider = provider || "claude"; viewGeneration++;
  historyMessages = []; lastSnapshot = ""; sessionData = null; initialScroll = true; refreshBusy = false;
  title.textContent = currentProvider === "codex" ? "Codex" : "Claude";
  back.hidden = false; composer.hidden = false; tabs.hidden = true; newBtn.hidden = true; stopBtn.hidden = true;
  main.replaceChildren(); restoreDraft(); refresh(); clearInterval(timer); timer = setInterval(refresh, 2500);
}
function send() {
  var text = input.value.trim(), key = draftKey(), path = sessionPath(), generation = viewGeneration;
  if ((!text && !pending.length) || !current || sending[key]) return;
  var original = input.value, images = pending.slice(), signature = JSON.stringify({text:text, images:images});
  var request = draftRequests[key];
  if (!request || request.signature !== signature) request = draftRequests[key] = {signature:signature, id:crypto.randomUUID()};
  sending[key] = true; sendBtn.disabled = true; saveDraft();
  api(path + "/send", {method:"POST", body:JSON.stringify({requestId:request.id, text:text, images:images})})
    .then(function () {
      delete draftRequests[key];
      if (generation === viewGeneration) {
        if (input.value === original) input.value = "";
        pending = pending.filter(function (i) { return !images.includes(i); });
        autosize(); renderShelf(); saveDraft(); lastSnapshot = ""; initialScroll = true; refresh();
      } else {
        var saved = drafts[key]; if (saved && saved.text === original) { saved.text = ""; saved.images = saved.images.filter(function (i) { return !images.includes(i); }); try { localStorage.removeItem("gs-draft:" + key); } catch (_) {} }
      }
    }).catch(function (e) { if (generation === viewGeneration) fail(e.message + " Your draft is saved; you can retry."); })
    .finally(function () { sending[key] = false; if (generation === viewGeneration) sendBtn.disabled = false; });
}
stopBtn.onclick = function () {
  var generation = viewGeneration; stopBtn.disabled = true;
  api(sessionPath() + "/stop", {method:"POST", body:"{}"}).then(function () { if (generation === viewGeneration) refresh(); })
    .catch(function (e) { if (generation === viewGeneration) fail(e.message); }).finally(function () { stopBtn.disabled = false; });
};
sendBtn.onclick = send;
input.addEventListener("input", saveDraft);
input.addEventListener("keydown", function (event) { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); } });
window.addEventListener("online", function () { networkMessage(""); refresh(); });
window.addEventListener("offline", function () { networkMessage("Offline. Your draft is saved. Reconnect to reach your desktop."); });
document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
window.addEventListener("pagehide", saveDraft);
new ResizeObserver(function () {
  document.documentElement.style.setProperty("--composer-height", composer.getBoundingClientRect().height + "px");
}).observe(composer);
`;
