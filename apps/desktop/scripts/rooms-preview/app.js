// Interactive design only. No network calls, credentials, or real sessions.
const $ = (selector) => document.querySelector(selector);
const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
const agents = {
	codex: {
		name: "Data model",
		provider: "Codex",
		owner: "Your session",
		activity: "Reviewing the schema",
		note: "Checking shared types and timezone behavior. This session shares its project updates here; its earlier conversation remains private.",
	},
	claude: {
		name: "Calendar interface",
		provider: "Claude Code",
		owner: "Daniel’s session",
		activity: "Waiting for review",
		note: "Building the weekly calendar in Daniel’s workspace. You can discuss the shared work here without taking over his session.",
	},
	gemini: {
		name: "Student research",
		provider: "Gemini",
		owner: "Your session",
		activity: "Ready for a question",
		note: "Turning student interviews into a short research brief. Useful for research, essays, and project planning as well as software work.",
	},
};
const messages = [
	{
		from: "you",
		text: "Let’s make a weekly planner that feels less like another assignment. Classes, study time, and a little breathing room.",
		time: "10:42",
	},
	{
		from: "daniel",
		text: "I’ll build the calendar with Claude. @Data model could you check the event structure before we connect the two?",
		time: "10:43",
	},
	{
		from: "codex",
		text: "Yes. I’d keep the original timezone on each event, then display it in the viewer’s local time. That avoids shifting classes when someone travels.",
		time: "10:44",
		file: true,
		replies: 2,
	},
	{
		from: "claude",
		text: "Good catch. I can use that structure without changing the calendar layout. One question: should study blocks count toward the weekly total?",
		time: "10:45",
	},
	{
		from: "you",
		text: "Yes, but keep them visually distinct from classes. @Student research, any thoughts from the interviews?",
		time: "10:46",
	},
];
const events = [
	{
		from: "claude",
		title: "Daniel shared Calendar interface",
		detail:
			"Claude Code joined from Daniel’s computer. Only this project’s updates are shared.",
		time: "10:43",
		symbol: "link",
	},
	{
		from: "codex",
		title: "Codex requested a schema review",
		detail: "schedule-schema.ts · 12 additions, 3 removals",
		time: "10:44",
		symbol: "file",
	},
	{
		from: "claude",
		title: "Claude asked about study blocks",
		detail:
			"A question in the room, with the discussion attached to the shared work.",
		time: "10:45",
		symbol: "chat",
	},
];
let view = "project",
	online = true,
	sharing = true,
	audience = "Everyone",
	running = false,
	generation = 0,
	approved = false;
let toastTimer,
	demoIndex = 0,
	activityFilter = null;
const threads = new Map([
	[
		2,
		[
			{
				from: "daniel",
				text: "Can we keep the original timezone when a student travels?",
			},
			{
				from: "you",
				text: "Yes. Store it per event so recurring classes remain stable.",
			},
		],
	],
]);
const scopes = { codex: true, gemini: true };
const timers = new Set();
const later = (fn, ms) => {
	const timer = setTimeout(() => {
		timers.delete(timer);
		fn();
	}, ms);
	timers.add(timer);
	return timer;
};
function toast(text) {
	clearTimeout(toastTimer);
	$("#toast").textContent = text;
	$("#toast").classList.add("visible");
	toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3200);
}
function avatar(from) {
	return agents[from]
		? `<span class="message-agent"><img src="assets/${from}.svg" alt="${agents[from].provider}"></span>`
		: `<span class="avatar ${from}">${from === "you" ? "Y" : "D"}</span>`;
}
function author(from) {
	return agents[from] ? agents[from].name : from === "you" ? "You" : "Daniel";
}
function artifact() {
	return `<div class="artifact-card"><span class="file-symbol">${icon("file")}</span><span><strong>schedule-schema.ts</strong><small>Codex · Shared for review</small></span><span class="delta">+12<span>−3</span></span><button class="secondary" data-file="schema">${approved ? `${icon("check")}Reviewed` : `Review${icon("chevron")}`}</button></div>`;
}
function messageMarkup(m, i) {
	const text = escapeHtml(m.text).replace(
		/@(Data model|Student research|Calendar interface)/g,
		'<span class="mention">@$1</span>',
	);
	return `<article class="message ${agents[m.from] ? "agent-message" : ""} ${m.fresh ? "new" : ""}" data-message="${i}">${avatar(m.from)}<div><div class="message-meta"><strong>${escapeHtml(author(m.from))}</strong>${agents[m.from] ? `<span class="owner">${escapeHtml(agents[m.from].provider)} · ${escapeHtml(agents[m.from].owner)}</span>` : ""}<time>${escapeHtml(m.time || "Now")}${m.queued ? " · Queued" : ""}</time></div><p>${text}</p>${m.file ? artifact() : ""}${m.replies ? `<button class="replies" data-replies="${i}"><span class="reply-icon">D</span><span class="reply-icon">Y</span> ${m.replies} replies ${icon("chevron")}</button>` : `<div class="message-actions"><button class="text-action" data-reply="${i}">${icon("chat")}Reply</button>${agents[m.from] ? `<button class="text-action" data-session="${m.from}">Session details ${icon("chevron")}</button>` : ""}</div>`}</div></article>`;
}
function render(scroll = false) {
	const content = $("#view-content");
	const oldTop = content.scrollTop;
	document.querySelectorAll('[role="tab"]').forEach((el) => {
		el.setAttribute("aria-selected", String(el.dataset.tab === view));
		el.tabIndex = el.dataset.tab === view ? 0 : -1;
	});
	content.innerHTML = `<div class="day-divider">Today</div>${messages.map(messageMarkup).join("")}`;
	$("#conversation-count").textContent = messages.length;
	renderProject(activityFilter);
	if (scroll)
		content.scrollTo({
			top: content.scrollHeight,
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
		});
	else content.scrollTop = oldTop;
	messages.forEach((m) => {
		m.fresh = false;
	});
}
function openInspector(title, kicker, content) {
	$("#inspector-title").textContent = title;
	$("#inspector-kicker").textContent = kicker;
	$("#inspector-content").innerHTML = content;
	if (!$("#inspector").open) $("#inspector").showModal();
}
function closeInspector() {
	$("#inspector").close();
}
function connectionState() {
	const connected = online && sharing;
	document.body.classList.toggle("offline", !online);
	document.body.classList.toggle("paused", !sharing);
	$("#connection-label").innerHTML =
		`<i class="tiny-dot"></i>${!sharing ? "Sharing paused" : online ? "Connected" : "Offline"}`;
	$("#connection-detail").textContent = !sharing
		? "Your work stays local"
		: online
			? "Only what you share"
			: "Messages will wait";
	$("#sidebar-presence").textContent = online ? "Online now" : "Offline";
	$("#friend-presence").textContent = online ? "Online" : "Offline";
	$("#offline span").textContent = online ? "Try disconnect" : "Reconnect";
	$("#delivery-note").hidden = connected;
	$("#delivery-note").textContent = !sharing
		? "Sharing is paused. New room messages will wait until you resume."
		: "Daniel is offline. Your messages will be delivered when he reconnects.";
	if (connected) {
		const queued = messages.filter((m) => m.queued);
		queued.forEach((m) => {
			m.queued = false;
		});
		if (queued.length) {
			transmit();
			events.push({
				title: `${queued.length} queued message${queued.length === 1 ? "" : "s"} delivered`,
				detail: "The conversation resumed from where you left off.",
				time: "Now",
				symbol: "check",
			});
			toast("Reconnected. Queued messages delivered in this demo.");
		}
	}
	render();
}
function transmit() {
	const el = $(".connection");
	el.classList.remove("transmitting");
	requestAnimationFrame(() =>
		requestAnimationFrame(() => el.classList.add("transmitting")),
	);
}
function addMessage(message) {
	const queued = !(online && sharing);
	messages.push({ ...message, time: "Now", fresh: true, queued });
	events.push({
		from: message.from,
		title: `${author(message.from)} ${queued ? "queued a message" : "posted in the room"}`,
		detail: message.text.slice(0, 130),
		time: "Now",
		symbol: "chat",
	});
	if (!queued) transmit();
	if (agents[message.from]) {
		const card = $(`[data-session-card="${message.from}"].session`);
		card?.classList.remove("flash");
		requestAnimationFrame(() => card?.classList.add("flash"));
	}
	render(true);
}
function showSession(id) {
	const agent = agents[id];
	openInspector(
		agent.name,
		"Shared session",
		`<div class="dialog-session"><img src="assets/${id}.svg" alt="${escapeHtml(agent.provider)}"><div><strong>${escapeHtml(agent.provider)}</strong><small>${escapeHtml(agent.owner)} · ${escapeHtml(agent.activity)}</small></div></div><p>${escapeHtml(agent.note)}</p><h3>Visible to the room</h3><ul class="checklist"><li>${icon("check")}Messages sent to the room</li><li>${icon("check")}Shared task status and files</li><li>${icon("lock")}Earlier conversation stays private</li></ul><h3>Latest shared exchange</h3><div class="thread-line"><p>${escapeHtml([...messages].reverse().find((m) => m.from === id)?.text || "This session is ready for a message. Ask it to contribute research or review the project brief.")}</p></div><div class="dialog-actions"><button class="primary" data-message-session="${id}">${icon("chat")}Message this session</button><button class="secondary" data-follow-session="${id}">${icon("activity")}Follow activity</button></div>`,
	);
}
function showSharing() {
	openInspector(
		"Choose what crosses over",
		"Sharing controls",
		`<p>You’re sharing with Daniel in <strong>Campus planner</strong>. Your other conversations, accounts, and credentials remain on your computer.</p><label class="scope-row"><img src="assets/codex.svg" width="24" alt=""><span>Data model<small>Codex · project updates and shared files</small></span><input type="checkbox" ${scopes.codex ? "checked" : ""} data-scope="codex" aria-label="Share Data model"></label><label class="scope-row"><img src="assets/gemini.svg" width="24" alt=""><span>Student research<small>Gemini · project updates and shared files</small></span><input type="checkbox" ${scopes.gemini ? "checked" : ""} data-scope="gemini" aria-label="Share Student research"></label><div class="scope-row">${icon("file")}<span>Shared files<small>2 files explicitly added to this room</small></span><span class="tag">Selected only</span></div><div class="dialog-actions"><button class="primary" id="save-sharing">Save sharing</button><button class="secondary" id="pause-sharing">${icon(sharing ? "pause" : "play")}${sharing ? "Pause sharing" : "Resume sharing"}</button></div>`,
	);
}
function showConnection() {
	openInspector(
		"Two workspaces, one room",
		"Workspace connection",
		`<div class="dialog-session"><span class="avatar daniel">D</span><div><strong>Daniel’s GatedSpace</strong><small>${online ? "Connected · Windows x64" : "Offline · Waiting to reconnect"}</small></div></div><p>Each person keeps control of their own computer and sessions. Room messages, selected artifacts, and project progress are the shared layer.</p><div class="scope-row">${icon("link")}<span>Connection<small>${online ? "Messages can be delivered" : "New messages remain queued"}</small></span><span class="tag">${online ? "Online" : "Offline"}</span></div><div class="scope-row">${icon("people")}<span>Room membership<small>You and Daniel · invitation only</small></span></div><div class="dialog-actions"><button class="primary" id="connection-toggle">${online ? "Simulate disconnect" : "Reconnect"}</button><button class="secondary" id="connection-sharing">Sharing settings</button></div><p style="margin-top:20px;font-size:10px">This preview simulates connection states. No computers are connected.</p>`,
	);
}
function invite() {
	openInspector(
		"Bring someone into the room",
		"Invite a collaborator",
		`<p>Connect their GatedSpace to this project. They choose which sessions to bring; you choose what to share.</p><label class="field">Room name<input id="room-name" value="Campus planner" maxlength="60"></label><label class="field">Role<select id="invite-role"><option>Collaborator — chat, share, and review</option><option>Observer — read shared updates</option></select></label><h3>Included in this invitation</h3><ul class="checklist"><li>${icon("check")}Room conversation and project brief</li><li>${icon("check")}Explicitly shared sessions and files</li><li>${icon("lock")}No private sessions or account access</li></ul><div class="dialog-actions"><button class="primary" id="create-invite">Create demo invitation ${icon("link")}</button></div>`,
	);
}
function showFile(file) {
	if (file === "brief") {
		openInspector(
			"Project brief",
			"project-brief.md · Shared by you",
			`<p><strong>A planner that makes room for life.</strong></p><p>Help students see classes, focused study time, and open time in one weekly view. The first version should be understandable without a tutorial.</p><h3>Who is doing what</h3><div class="scope-row"><img src="assets/codex.svg" width="22" alt="Codex"><span>Data model<small>Your session · shared types and timezone handling</small></span></div><div class="scope-row"><img src="assets/claude.svg" width="22" alt="Claude"><span>Calendar interface<small>Daniel’s session · layout and interactions</small></span></div><div class="scope-row"><img src="assets/gemini.svg" width="22" alt="Gemini"><span>Student research<small>Your session · interview synthesis</small></span></div><h3>Done means</h3><p>Add a class, block study time, and see a useful weekly total. Timezones should remain correct when traveling.</p><div class="dialog-actions"><button class="primary" id="discuss-brief">Discuss in the room</button></div>`,
		);
		return;
	}
	openInspector(
		"A small change, reviewed together",
		"schedule-schema.ts · Revision 2",
		`<p>Codex proposed keeping the original timezone. Daniel’s Claude session will use the reviewed schema in the calendar.</p><div class="code-preview" aria-label="Code diff"><span class="code-line"><i>01</i><b>export type</b> PlannerEvent = {</span><span class="code-line"><i>02</i>  id: <b>string</b>;</span><span class="code-line"><i>03</i>  title: <b>string</b>;</span><span class="code-line del"><i>04</i>− date: <b>Date</b>;</span><span class="code-line add"><i>04</i>+ startsAt: <b>string</b>;</span><span class="code-line add"><i>05</i>+ timeZone: <b>string</b>;</span><span class="code-line add"><i>06</i>+ kind: <em>"class"</em> | <em>"study"</em>;</span><span class="code-line"><i>07</i>};</span></div><div class="review-foot">${approved ? "Reviewed by you · Daniel can continue" : "Awaiting your review · 2 comments from the team"}</div><h3>Daniel · Calendar interface</h3><p>“This works with the calendar. I’ll format startsAt for the viewer and keep timeZone for recurring classes.”</p><div class="dialog-actions"><button class="primary" id="approve" ${approved ? "disabled" : ""}>${icon("check")}${approved ? "Reviewed" : "Mark reviewed"}</button><button class="secondary" id="discuss-schema">${icon("chat")}Discuss change</button></div>`,
	);
}
function showReplies(index) {
	const m = messages[index];
	openInspector(
		"Keep the discussion attached",
		"Replies · schedule-schema.ts",
		`<div class="thread-line"><strong>${escapeHtml(author(m.from))}</strong><p>${escapeHtml(m.text)}</p></div>${(threads.get(index) || []).map((reply) => `<div class="thread-line"><strong>${escapeHtml(author(reply.from))}</strong><p>${escapeHtml(reply.text)}</p></div>`).join("")}<form id="reply-form" data-thread="${index}"><label class="field">Reply<input id="reply-text" placeholder="Add to this discussion…" required></label><div class="dialog-actions"><button class="primary" type="submit">Send reply ${icon("arrow")}</button><button class="secondary" type="button" data-file="schema">Open the change</button></div></form>`,
	);
}
function stopDemo(completed = false) {
	running = false;
	generation++;
	$("#play").innerHTML =
		icon("play") +
		`<span>${completed ? "Replay handoff" : demoIndex ? "Resume handoff" : "Play handoff"}</span>`;
}
function play() {
	if (running) {
		stopDemo();
		toast("Demo paused. Your place is preserved.");
		return;
	}
	running = true;
	const run = ++generation;
	view = "project";
	$("#play").innerHTML = `${icon("pause")}<span>Pause demo</span>`;
	const script = [
		{
			from: "gemini",
			text: "Students talked about protecting open time, not filling every gap. I’d show classes and study hours separately, with unscheduled time left quiet.",
		},
		{
			from: "daniel",
			text: "That’s the direction. @Calendar interface, use a soft fill for study blocks. No extra productivity score.",
		},
		{
			from: "claude",
			text: "Agreed. I’ve updated the calendar with separate class and study styles. @Data model, the timezone change is ready to review against the UI.",
		},
		{
			from: "codex",
			text: "Reviewed the handoff: the weekly total counts study time, the legend distinguishes it from classes, and the original timezone is preserved. The schema is ready.",
			file: true,
		},
		{
			from: "daniel",
			text: "Nice. I can continue from here in my workspace. Everything we agreed on is in the shared brief.",
		},
	];
	let n = demoIndex >= script.length ? 0 : demoIndex;
	const step = () => {
		if (run !== generation || !running) return;
		if (!online || !sharing) {
			later(step, 1000);
			return;
		}
		const m = script[n++];
		demoIndex = n;
		if (scopes[m.from] === false) {
			later(step, 100);
			return;
		}
		addMessage(m);
		if (agents[m.from]) {
			agents[m.from].activity =
				n === 4 ? "Review complete" : "Posted an update";
			$(`#${m.from}-state`).textContent = agents[m.from].activity;
		}
		if (n < script.length) later(step, 2200);
		else {
			stopDemo(true);
			$(".task-progress span").style.width = "100%";
			$("#progress-label").textContent = "3 of 3 handoffs ready";
			events.push({
				title: "The handoff is ready",
				detail:
					"Research, schema, and interface decisions are captured in the room.",
				time: "Now",
				symbol: "check",
			});
			toast("Handoff complete. Open the change to review it.");
		}
	};
	render(true);
	later(step, 600);
}
document.addEventListener("click", (event) => {
	const button = event.target.closest("button");
	if (!button) return;
	const {
		action,
		tab,
		session,
		file,
		reply,
		replies,
		messageSession,
		followSession,
		view: navView,
	} = button.dataset;
	if (tab) {
		view = tab;
		render();
		return;
	}
	if (navView) {
		view = navView === "recent" ? "activity" : navView;
		render();
		return;
	}
	if (session) {
		showSession(session);
		return;
	}
	if (file) {
		showFile(file);
		return;
	}
	if (replies !== undefined) {
		showReplies(Number(replies));
		return;
	}
	if (reply !== undefined) {
		$("#message").value = `@${author(messages[Number(reply)].from)} `;
		$("#message").focus();
		return;
	}
	if (messageSession) {
		audience = agents[messageSession].name;
		$("#audience").innerHTML =
			icon("people") + escapeHtml(audience) + icon("chevron");
		closeInspector();
		$("#message").focus();
		return;
	}
	if (followSession) {
		activityFilter = followSession;
		view = "activity";
		closeInspector();
		render();
		toast(`Showing shared activity from ${agents[followSession].name}.`);
		return;
	}
	if (action === "invite") {
		invite();
		return;
	}
	if (action === "sharing") {
		showSharing();
		return;
	}
	if (action === "connection") {
		showConnection();
		return;
	}
	switch (button.id) {
		case "clear-filter":
			activityFilter = null;
			render();
			break;
		case "sharing":
		case "connection-sharing":
			showSharing();
			break;
		case "new-room":
			invite();
			break;
		case "close-inspector":
			closeInspector();
			break;
		case "toggle-sessions":
			document.body.classList.toggle("team-hidden");
			button.setAttribute(
				"aria-expanded",
				String(getComputedStyle($("#team-panel")).display !== "none"),
			);
			break;
		case "offline":
			online = !online;
			connectionState();
			break;
		case "connection-toggle":
			online = !online;
			connectionState();
			showConnection();
			break;
		case "pause-sharing":
			sharing = !sharing;
			connectionState();
			showSharing();
			break;
		case "save-sharing": {
			for (const el of document.querySelectorAll("[data-scope]")) {
				scopes[el.dataset.scope] = el.checked;
				$(`.session[data-session-card=${el.dataset.scope}]`).hidden =
					!el.checked;
			}
			const count = Object.values(scopes).filter(Boolean).length;
			$(".profile small").textContent = `Sharing ${count} sessions`;
			$(".team-head>span").textContent = `${count + 1} sessions`;
			const selected = [
				...document.querySelectorAll("[data-scope]:checked"),
			].map((el) => agents[el.dataset.scope].name);
			closeInspector();
			toast(
				`Sharing saved in this demo: ${selected.join(", ") || "no sessions"}.`,
			);
			break;
		}
		case "play":
			play();
			break;
		case "help":
			openInspector(
				"Try working together",
				"About this interactive concept",
				`<p>This is a local design preview for connecting two GatedSpace workspaces. No computers or providers are connected.</p><ul class="checklist"><li>${icon("play")}Play a conversation and handoff</li><li>${icon("file")}Review a shared code change</li><li>${icon("globe")}Disconnect, send, and reconnect</li><li>${icon("people")}Inspect sessions and sharing scopes</li></ul>`,
			);
			break;
		case "create-invite": {
			const name = $("#room-name").value.trim() || "Campus planner";
			const role = $("#invite-role").value;
			openInspector(
				"Your invitation is ready",
				"Demo invitation",
				`<p><strong>${escapeHtml(name)}</strong><br>${escapeHtml(role)}</p><div class="invite-code"><small>Example only — this is not a live invitation</small>GATEDSPACE · CAMPUS · 8F2K</div><div class="dialog-actions"><button class="primary" id="copy-invite">Copy demo code ${icon("link")}</button></div><p style="margin-top:20px;font-size:10px">In the finished feature, your friend would open an expiring invitation in GatedSpace and choose what to share.</p>`,
			);
			break;
		}
		case "copy-invite":
			navigator.clipboard
				?.writeText("DEMO ONLY — GATEDSPACE · CAMPUS · 8F2K")
				.then(() => toast("Demo code copied. It does not connect a workspace."))
				.catch(() => toast("Select and copy the demo code above."));
			break;
		case "add-session":
			openInspector(
				"Share a session",
				"Your workspace",
				`<p>Keep working in the same real session. Share its project updates with the room when you’re ready.</p><button class="scope-row" style="width:100%;text-align:left" data-session="codex"><img src="assets/codex.svg" width="24" alt=""><span>Data model<small>Codex · already shared</small></span><span class="tag">In room</span></button><button class="scope-row" style="width:100%;text-align:left" data-session="gemini"><img src="assets/gemini.svg" width="24" alt=""><span>Student research<small>Gemini · already shared</small></span><span class="tag">In room</span></button><div class="dialog-actions"><button class="primary" id="new-session">Create a dedicated session</button></div>`,
			);
			break;
		case "new-session":
			openInspector(
				"A session for this project",
				"Create and share",
				`<label class="field">Provider<select id="new-provider"><option>Claude Code</option><option>Codex</option><option>Gemini</option></select></label><label class="field">Responsibility<input id="new-role" placeholder="For example, accessibility review"></label><p style="margin-top:16px">This preview demonstrates setup only. A real session is not launched.</p><div class="dialog-actions"><button class="primary" id="finish-session">Preview session setup</button></div>`,
			);
			break;
		case "finish-session": {
			const role = $("#new-role").value.trim() || "Project review";
			const provider = $("#new-provider").value;
			closeInspector();
			toast(`${provider} · ${role} — setup previewed; no session launched.`);
			break;
		}
		case "attach":
			openInspector(
				"Share a project file",
				"Choose what the room can see",
				`<p>A shared file keeps its author, version, and discussion. Pick a sample artifact to try the review experience.</p><div class="dialog-actions"><button class="secondary" data-file="schema">${icon("file")}schedule-schema.ts</button><button class="secondary" data-file="brief">${icon("file")}project-brief.md</button></div>`,
			);
			break;
		case "audience":
			openInspector(
				"Who should see this?",
				"Message destination",
				`<p>Everyone can follow messages addressed to a session in this room. Private conversations stay in your workspace.</p>${["Everyone", ...Object.values(agents).map((a) => a.name)].map((name) => `<button class="scope-row" style="width:100%;text-align:left" data-audience="${escapeHtml(name)}">${icon(name === "Everyone" ? "people" : "chat")}<span>${escapeHtml(name)}</span>${name === audience ? '<span class="tag">Selected</span>' : ""}</button>`).join("")}`,
			);
			break;
		case "approve":
			approved = true;
			addMessage({
				from: "you",
				text: "Reviewed schedule-schema.ts. The timezone and study-block changes look good. Daniel, you’re clear to continue.",
			});
			showFile("schema");
			break;
		case "discuss-schema":
			closeInspector();
			$("#message").value = "About schedule-schema.ts: ";
			$("#message").focus();
			break;
		case "discuss-brief":
			closeInspector();
			$("#message").value = "About the project brief: ";
			$("#message").focus();
			break;
	}
	if (button.dataset.audience) {
		audience = button.dataset.audience;
		$("#audience").innerHTML =
			icon("people") + escapeHtml(audience) + icon("chevron");
		closeInspector();
		$("#message").focus();
	}
});
$("#composer").addEventListener("submit", (event) => {
	event.preventDefault();
	const field = $("#message");
	const text = field.value.trim();
	if (!text) return;
	addMessage({
		from: "you",
		text: audience === "Everyone" ? text : `@${audience} ${text}`,
	});
	field.value = "";
	field.focus();
	if (online && sharing) toast("Message added to the local demo conversation.");
});
$("#message").addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		$("#composer").requestSubmit();
	}
});
document.addEventListener("submit", (event) => {
	if (event.target.id !== "reply-form") return;
	event.preventDefault();
	const text = $("#reply-text").value.trim();
	if (!text) return;
	const index = Number(event.target.dataset.thread);
	const replies = threads.get(index) || [];
	replies.push({ from: "you", text });
	threads.set(index, replies);
	messages[index].replies = replies.length;
	addMessage({ from: "you", text: `On the schema review: ${text}` });
	closeInspector();
	toast("Reply added to the demo room.");
});
$("#inspector").addEventListener("click", (event) => {
	if (event.target !== $("#inspector")) return;
	const rect = event.target.getBoundingClientRect();
	if (
		event.clientX < rect.left ||
		event.clientX > rect.right ||
		event.clientY < rect.top ||
		event.clientY > rect.bottom
	)
		closeInspector();
});
window.addEventListener("pagehide", () => {
	stopDemo();
	for (const timer of timers) clearTimeout(timer);
	clearTimeout(toastTimer);
});
document.querySelector(".view-tabs").addEventListener("keydown", (event) => {
	const tabs = [...document.querySelectorAll("[role=tab]")];
	const index = tabs.indexOf(event.target);
	if (index < 0) return;
	let target;
	if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
	else if (event.key === "ArrowLeft")
		target = (index + tabs.length - 1) % tabs.length;
	else if (event.key === "Home") target = 0;
	else if (event.key === "End") target = tabs.length - 1;
	else return;
	event.preventDefault();
	tabs[target].focus();
	tabs[target].click();
});
