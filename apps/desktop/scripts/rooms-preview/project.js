// Companion to app.js: project-first layout and local-only friendship demo.
let selectedSession = "claude";
let focusedSession = false;
let sessionView = "conversation";
let friendRequest = null;
let chatOpen = false;
const sessionOutputs = {
	claude:
		() => `<div class="canvas-toolbar"><div><span class="mini-dot"></span>Shared preview <span class="muted">· Calendar interface</span></div><span class="output-label">Daniel’s workspace</span></div>
 <div class="calendar-preview"><header><div><span class="calendar-brand">campus<span>/</span></span><h2>A little more room<br>in your week.</h2></div><span class="week-pill">Nov 9 – 13</span></header><div class="week-grid"><div class="hours"><span>09:00</span><span>11:00</span><span>13:00</span><span>15:00</span></div>${["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, i) => `<div class="calendar-day ${i === 2 ? "today" : ""}"><div class="day-label">${day}<b>${9 + i}</b></div><div class="day-track">${i === 0 ? '<div class="cal-event class-event one"><b>Design studio</b><small>09:00 – 10:30</small></div><div class="cal-event study-event three"><b>Reading</b><small>13:00 – 14:00</small></div>' : i === 1 ? '<div class="cal-event class-event two"><b>Economics</b><small>11:00 – 12:00</small></div>' : i === 2 ? '<div class="cal-event class-event one"><b>Design studio</b><small>09:00 – 10:30</small></div><div class="cal-event study-event four"><b>Essay draft</b><small>15:00 – 16:00</small></div>' : i === 3 ? '<div class="cal-event study-event two"><b>Study group</b><small>11:00 – 12:00</small></div>' : '<div class="cal-event class-event two"><b>Economics</b><small>11:00 – 12:00</small></div>'}</div></div>`).join("")}</div><footer><span><i class="legend-class"></i>Classes</span><span><i class="legend-study"></i>Study time</span><small>Leave the gaps open.</small></footer></div>
 <div class="output-note"><img src="assets/claude.svg" alt="Claude Code"><p><strong>Ready for a second pair of eyes.</strong><br>Classes and study blocks now have separate styles. The timezone handoff is waiting on your review.</p><button class="secondary" data-file="schema">Review handoff ${icon("chevron")}</button></div>`,
	codex: () =>
		`<div class="canvas-toolbar"><div>${icon("file")}schedule-schema.ts <span class="muted">· Shared revision 2</span></div><span class="delta">+12 <span>−3</span></span></div><div class="editor-surface"><div class="editor-breadcrumb">src ${icon("chevron")} planner ${icon("chevron")} schedule-schema.ts</div><div class="code-preview"><span class="code-line"><i>01</i><b>export type</b> PlannerEvent = {</span><span class="code-line"><i>02</i>  id: <b>string</b>;</span><span class="code-line"><i>03</i>  title: <b>string</b>;</span><span class="code-line del"><i>04</i>− date: <b>Date</b>;</span><span class="code-line add"><i>04</i>+ startsAt: <b>string</b>;</span><span class="code-line add"><i>05</i>+ timeZone: <b>string</b>;</span><span class="code-line add"><i>06</i>+ kind: <em>"class"</em> | <em>"study"</em>;</span><span class="code-line"><i>07</i>};</span><span class="code-line"><i>08</i></span><span class="code-line comment"><i>09</i>// Preserve the source timezone when traveling.</span><span class="code-line"><i>10</i><b>export function</b> formatEvent(event: PlannerEvent) {</span><span class="code-line"><i>11</i>  <b>return new</b> Intl.DateTimeFormat(<em>"en-US"</em>, {</span><span class="code-line"><i>12</i>    timeZone: event.timeZone,</span><span class="code-line"><i>13</i>    hour: <em>"numeric"</em>, minute: <em>"2-digit"</em></span><span class="code-line"><i>14</i>  }).format(<b>new</b> Date(event.startsAt));</span><span class="code-line"><i>15</i>}</span></div></div><div class="output-note"><img src="assets/codex.svg" alt="Codex"><p><strong>${approved ? "Reviewed together" : "One shared contract."}</strong><br>Daniel’s calendar can use the same event structure. The discussion stays attached to this revision.</p><button class="secondary" data-file="schema">${approved ? "View review" : "Review change"} ${icon("chevron")}</button></div>`,
	gemini: () =>
		`<div class="canvas-toolbar"><div>${icon("file")}student-interviews.md</div><span class="output-label">Shared research</span></div><article class="research-output"><span class="eyebrow">Campus planner · Research note 03</span><h2>Plan the essentials.<br>Protect the open time.</h2><p class="research-lead">Students want a clearer week, not another measure of how productive they should be.</p><blockquote>“I want to see when I’m free without feeling like I need to fill it.”<cite>Illustrative interview excerpt · demo content</cite></blockquote><h3>What this changes in the calendar</h3><p>Show classes and study time as distinct blocks. Keep unscheduled hours quiet. A weekly total should describe the plan without grading it.</p><div class="research-source">${icon("link")}Interview synthesis → calendar direction → shared brief</div></article><div class="output-note"><img src="assets/gemini.svg" alt="Gemini"><p><strong>Research everyone can build on.</strong><br>Use this same space for essays, shared reading, and writing feedback.</p><button class="secondary" data-session="gemini">Session details ${icon("chevron")}</button></div>`,
};

const sessionBriefs = {
	claude:
		"Build the weekly calendar. Keep classes and study time distinct, and leave the gaps quiet.",
	codex:
		"Check the event structure with Daniel’s Claude session. Preserve timezones when students travel.",
	gemini:
		"Turn the student interviews into guidance we can use in the calendar, with a short written brief.",
};
const sessionDeliverables = {
	claude: ["Calendar preview", "Shared interface · ready to review"],
	codex: ["schedule-schema.ts", "Shared change · +12 −3"],
	gemini: ["student-interviews.md", "Research brief · shared context"],
};
function sessionStatus(id) {
	return !sharing
		? "Sharing paused"
		: !online && id === "claude"
			? "Daniel is offline"
			: agents[id].activity;
}
function latestSharedMessage(id) {
	return [...messages].reverse().find((message) => message.from === id)?.text;
}
function sessionPane(id) {
	const agent = agents[id];
	const [file, note] = sessionDeliverables[id];
	const latest = latestSharedMessage(id);
	const fresh = messages.some(
		(message) => message.from === id && message.fresh,
	);
	return `<article class="collab-pane ${id === "claude" ? "friend-pane" : ""} ${fresh ? "flash" : ""}" data-pane="${id}" aria-label="${agent.name} session">
	<header class="collab-pane-header"><img src="assets/${id}.svg" alt="${agent.provider}"><div><h2>${agent.name}</h2><span>${agent.provider}</span></div><button class="icon-button" data-select-session="${id}" aria-label="Focus ${agent.name}" title="Focus session">${icon("panel")}</button></header>
	<div class="pane-ownership"><span class="avatar ${id === "claude" ? "daniel" : "you"}">${id === "claude" ? "D" : "Y"}</span><span>${id === "claude" ? "Daniel’s session" : "Your session"}</span><span class="pane-state"><i></i>${escapeHtml(sessionStatus(id))}</span></div>
	<div class="pane-stream"><div class="session-brief"><span>${id === "claude" ? "Daniel" : "You"}</span><p>${sessionBriefs[id]}</p></div><div class="shared-agent-message"><div><img src="assets/${id}.svg" alt=""><strong>${agent.provider}</strong><small>${latest ? "Shared in project chat" : "Shared task"}</small></div><p>${escapeHtml(latest || "Research is ready for a question. Ask this session to share its findings with the project.")}</p></div>${id === "claude" ? `<div class="session-handoff">${icon("link")}<div><strong>Working with your Data model session</strong><span>Calendar ↔ event schema</span></div><button class="text-action" data-select-session="codex">Inspect ${icon("chevron")}</button></div>` : ""}</div>
	<button class="pane-deliverable" data-output-session="${id}">${icon(id === "claude" ? "globe" : "file")}<span><strong>${file}</strong><small>${note}</small></span>${icon("chevron")}</button>
	<footer><button class="text-action" data-message-session="${id}">${icon("chat")}Message session</button><button class="text-action" data-select-session="${id}">Open session ${icon("chevron")}</button></footer></article>`;
}
function focusedConversation(id) {
	const agent = agents[id];
	const shared = messages.filter(
		(m) => m.from === id || m.text.includes(`@${agent.name}`),
	);
	return `<div class="focused-conversation"><div class="shared-only">${icon("lock")}Shared project messages · private history stays on its owner’s computer</div><div class="session-brief"><span>${id === "claude" ? "Daniel" : "You"} · Shared task</span><p>${sessionBriefs[id]}</p></div>${shared.map((m) => `<article class="focused-message"><div>${avatar(m.from)}<strong>${escapeHtml(author(m.from))}</strong><time>${escapeHtml(m.time || "Now")}</time></div><p>${escapeHtml(m.text)}</p>${m.file ? artifact() : ""}</article>`).join("") || '<p class="session-waiting">No shared message yet. Ask this session to contribute to the project.</p>'}<button class="pane-deliverable" data-output-session="${id}">${icon("file")}<span><strong>${sessionDeliverables[id][0]}</strong><small>Open this session’s shared output</small></span>${icon("chevron")}</button></div><div class="focused-composer"><span>Continue with ${agent.name}</span><button class="secondary" data-message-session="${id}">${icon("chat")}Message session</button></div>`;
}

// biome-ignore lint/correctness/noUnusedVariables: the shared renderer in app.js calls this companion function.
function renderProject(activityFilter) {
	const work = $("#work-content");
	$("#team-panel").hidden = view !== "project" || !focusedSession;
	$(".project-pane").classList.toggle(
		"sessions-overview",
		view === "project" && !focusedSession,
	);
	if (view === "project") {
		if (scopes[selectedSession] === false) selectedSession = "claude";
		const a = agents[selectedSession];
		work.innerHTML = focusedSession
			? `<div class="focus-navigation"><button class="text-action" id="all-sessions">${icon("layers")}All sessions</button><div class="session-view-switch" aria-label="Session view"><button data-session-view="conversation" aria-pressed="${sessionView === "conversation"}">Conversation</button><button data-session-view="output" aria-pressed="${sessionView === "output"}">Shared output</button></div></div><section class="session-output" aria-label="${escapeHtml(a.name)} shared session"><header class="session-output-header"><div><img src="assets/${selectedSession}.svg" alt="${a.provider}"><span><strong>${a.name}</strong><small>${a.owner} · ${escapeHtml(sessionStatus(selectedSession))}</small></span></div><button class="text-action" data-session="${selectedSession}">Session details ${icon("chevron")}</button></header>${sessionView === "output" ? sessionOutputs[selectedSession]() : focusedConversation(selectedSession)}</section>`
			: `<div class="sessions-heading"><div><h2>Your sessions, together</h2><p>Daniel’s workspace and yours, side by side.</p></div><span>${1 + Object.values(scopes).filter(Boolean).length} shared</span></div><div class="sessions-board">${[
					"claude",
					"codex",
					"gemini",
				]
					.filter((id) => scopes[id] !== false)
					.map(sessionPane)
					.join("")}</div>`;
	} else if (view === "activity") {
		work.innerHTML = `<section class="work-list"><header><h2>Project activity</h2><p>Shared updates, with a person and a session behind each one.</p></header>${activityFilter ? `<div class="activity-filter">${agents[activityFilter].name}<button class="text-action" id="clear-filter">Show all activity</button></div>` : ""}<ul class="event-list">${[
			...events,
		]
			.reverse()
			.filter((e) => !activityFilter || e.from === activityFilter)
			.map(
				(e) =>
					`<li><span class="event-mark">${icon(e.symbol)}</span><div><strong>${escapeHtml(e.title)}</strong><p>${escapeHtml(e.detail)}</p></div><time>${e.time}</time></li>`,
			)
			.join("")}</ul></section>`;
	} else if (view === "files") {
		work.innerHTML = `<section class="work-list"><header><h2>Shared files</h2><p>Selected work from both computers. Each revision keeps its discussion.</p></header>${artifact()}<div class="artifact-card"><span class="file-symbol">${icon("file")}</span><span><strong>project-brief.md</strong><small>You · Shared context</small></span><button class="secondary" data-file="brief">Open ${icon("chevron")}</button></div></section>`;
	} else {
		work.innerHTML = `<section class="empty-view">${icon("lock")}<h2>Your workspace is still yours.</h2><p>Friends see only the projects and session updates you share with them.</p><button class="secondary" data-tab="project">Back to Campus planner</button></section>`;
	}
	document.querySelectorAll(".session[data-select-session]").forEach((el) => {
		const active = el.dataset.selectSession === selectedSession;
		el.classList.toggle("selected", active);
		el.setAttribute("aria-pressed", String(active));
	});
}

function showAddFriend() {
	openInspector(
		"Add a friend",
		"People, then projects",
		`<p>Find someone by their GatedSpace handle. Becoming friends makes it easy to see when they’re around and choose a project to share.</p><form id="friend-form"><label class="field">GatedSpace handle<input id="friend-handle" placeholder="@your-friend" autocomplete="off" required maxlength="32" pattern="@?[A-Za-z0-9_][A-Za-z0-9_.-]{1,30}" aria-describedby="friend-help"></label><p id="friend-help" class="form-hint">Letters, numbers, dots, dashes, and underscores.</p><div class="friend-scope">${icon("lock")}A friend request does not share your sessions or files.</div><div class="dialog-actions"><button class="primary" type="submit">Preview friend request ${icon("arrow")}</button></div></form><p class="demo-disclaimer">Design preview. No real request will be sent.</p>`,
	);
}
function showFriendRequest() {
	openInspector(
		friendRequest.accepted
			? `You and ${friendRequest.name} are friends`
			: "Friend request pending",
		"Friendship preview",
		`<div class="dialog-session"><span class="avatar new-friend">${escapeHtml(friendRequest.name[0].toUpperCase())}</span><div><strong>${escapeHtml(friendRequest.name)}</strong><small>@${escapeHtml(friendRequest.handle)} · ${friendRequest.accepted ? "Online" : "Request sent in this demo"}</small></div></div><p>${friendRequest.accepted ? "You can now choose a project to share. Your other work stays private." : "They’ll see your request in GatedSpace. Your project and sessions remain private until you choose to share them."}</p><div class="dialog-actions">${friendRequest.accepted ? '<button class="primary" data-action="invite">Share a project</button>' : '<button class="primary" id="accept-friend">Simulate acceptance</button><button class="secondary" id="cancel-friend">Cancel request</button>'}</div><p class="demo-disclaimer">Local design demo only.</p>`,
	);
}
function updateFriends() {
	document.querySelector("[data-friend=demo]")?.remove();
	if (friendRequest) {
		const button = document.createElement("button");
		button.className = "friend";
		button.dataset.friend = "demo";
		button.innerHTML = `<span class="avatar new-friend mini">${escapeHtml(friendRequest.name[0].toUpperCase())}${friendRequest.accepted ? "<i></i>" : ""}</span><span><strong>${escapeHtml(friendRequest.name)}</strong><small>${friendRequest.accepted ? "Online now" : "Request pending"}</small></span>`;
		$("#friend-list").append(button);
	}
	$("#friend-count").textContent = friendRequest?.accepted ? "2" : "1";
}
function focusChat() {
	chatOpen = true;
	document.body.classList.add("chat-open");
	document.body.classList.remove("chat-hidden");
	$("#toggle-chat").setAttribute("aria-expanded", "true");
}
document.addEventListener("click", (event) => {
	const button = event.target.closest("button");
	if (!button) return;
	if (button.dataset.selectSession) {
		selectedSession = button.dataset.selectSession;
		focusedSession = true;
		sessionView = "conversation";
		view = "project";
		render();
	}
	if (button.dataset.outputSession) {
		selectedSession = button.dataset.outputSession;
		focusedSession = true;
		sessionView = "output";
		view = "project";
		render();
	}
	if (button.dataset.sessionView) {
		sessionView = button.dataset.sessionView;
		render();
	}
	if (
		button.id === "all-sessions" ||
		button.dataset.tab === "project" ||
		button.dataset.friend === "daniel" ||
		button.dataset.view === "project"
	) {
		focusedSession = false;
		render();
	}
	if (button.id === "add-friend" || button.dataset.action === "add-friend")
		showAddFriend();
	if (button.dataset.friend === "demo") showFriendRequest();
	if (button.dataset.friend === "daniel") {
		view = "project";
		render();
	}
	if (button.id === "accept-friend") {
		friendRequest.accepted = true;
		updateFriends();
		showFriendRequest();
		toast(`${friendRequest.name} is now a friend in this demo.`);
	}
	if (button.id === "cancel-friend") {
		friendRequest = null;
		updateFriends();
		closeInspector();
	}
	if (button.id === "toggle-chat") {
		if (matchMedia("(max-width: 1040px)").matches) {
			chatOpen = !chatOpen;
			document.body.classList.toggle("chat-open", chatOpen);
		} else document.body.classList.toggle("chat-hidden");
		button.setAttribute(
			"aria-expanded",
			String(getComputedStyle($(".conversation-pane")).display !== "none"),
		);
	}
	if (
		button.dataset.messageSession ||
		button.dataset.audience ||
		button.dataset.reply !== undefined ||
		button.id === "discuss-schema" ||
		button.id === "discuss-brief"
	) {
		focusChat();
		$("#message").focus();
	}
	if (button.id === "save-sharing") render();
});
document.addEventListener("submit", (event) => {
	if (event.target.id !== "friend-form") return;
	event.preventDefault();
	const handle = $("#friend-handle").value.trim().replace(/^@/, "");
	if (handle.toLowerCase() === "daniel") {
		toast("Daniel is already your friend.");
		return;
	}
	friendRequest = {
		handle,
		name: handle[0].toUpperCase() + handle.slice(1),
		accepted: false,
	};
	updateFriends();
	showFriendRequest();
});

const divider = $(".chat-divider");
function resizeChat(width) {
	const value = Math.round(Math.max(300, Math.min(520, width)));
	$(".workspace-split").style.setProperty("--chat-width", `${value}px`);
	divider.setAttribute("aria-valuenow", String(value));
}
divider.addEventListener("pointerdown", (event) => {
	if (event.button !== 0) return;
	event.preventDefault();
	divider.setPointerCapture(event.pointerId);
	document.body.classList.add("resizing-chat");
});
divider.addEventListener("pointermove", (event) => {
	if (!divider.hasPointerCapture(event.pointerId)) return;
	resizeChat(
		$(".workspace-split").getBoundingClientRect().right - event.clientX,
	);
});
const endResize = () => document.body.classList.remove("resizing-chat");
divider.addEventListener("lostpointercapture", endResize);
divider.addEventListener("pointercancel", endResize);
divider.addEventListener("keydown", (event) => {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	resizeChat(
		event.key === "Home"
			? 300
			: event.key === "End"
				? 520
				: Number(divider.getAttribute("aria-valuenow")) +
					(event.key === "ArrowLeft" ? 20 : -20),
	);
});
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !$("#inspector").open) {
		chatOpen = false;
		document.body.classList.remove("chat-open");
	}
});
render();
