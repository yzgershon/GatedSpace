// Design-only sample. Does not capture screens or call session/provider APIs.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const names = { codex: "Codex", claude: "Claude", gemini: "Gemini" };
const examples = [
	{
		id: "workspace",
		name: "GS Edits",
		panes: [
			{
				ai: "codex",
				title: "Desktop polish",
				status: "Working",
				context: "142k",
				prompt: "Make the floating tabs feel like part of the desktop.",
				heading: "A clearer way to switch sessions",
				body: "The tab rail fits the sessions you have open. Hovering lifts the selected mark without moving its neighbors.",
				detail:
					"I’m checking the smaller details: longer names, mixed-provider panes, and quick movement across the rail.",
				file: "TopBar.tsx",
				kind: "2 files changed",
			},
			{
				ai: "claude",
				title: "Design review",
				status: "Ready",
				context: "86k",
				prompt: "Review the navigation and hover interaction.",
				heading: "Keep the interaction predictable",
				body: "The hover window makes each pane recognizable before you switch. Provider labels stay visible even when the conversations have similar names.",
				detail:
					"The pink outline is shared with the composer. It gives the controls a consistent finish without changing the existing menus.",
				file: "Navigation review.md",
				kind: "Review complete",
			},
		],
	},
	{
		id: "college",
		name: "College",
		panes: [
			{
				ai: "claude",
				title: "Essay revision",
				status: "Ready",
				context: "208k",
				prompt: "Help me make the opening more specific.",
				heading: "Start with the moment",
				body: "The strongest opening is the small scene you described. Keep the details that sound like you and let the meaning emerge naturally.",
				detail: "I marked two places where the draft can be more direct.",
				file: "Essay draft.md",
				kind: "Draft reviewed",
			},
			{
				ai: "codex",
				title: "Source check",
				status: "Working",
				context: "92k",
				prompt: "Check the sources and organize the notes.",
				heading: "Sources and working notes",
				body: "The notes are organized by claim. Each reference stays next to the point it supports.",
				detail:
					"I’m reviewing the remaining references before handing the list back.",
				file: "Sources.md",
				kind: "Checking references",
			},
			{
				ai: "gemini",
				title: "Writing ideas",
				status: "Ready",
				context: "64k",
				prompt: "Suggest a different structure for the essay.",
				heading: "Another way into the story",
				body: "The middle scene could open the essay. It introduces the question before explaining how your thinking changed.",
				detail:
					"The alternative outline keeps your facts and leaves space for your voice.",
				file: "Alternative outline.md",
				kind: "Outline ready",
			},
		],
	},
	{
		id: "calc",
		name: "Calc Biz",
		panes: [
			{
				ai: "codex",
				title: "Calendar build",
				status: "Ready",
				context: "74k",
				prompt: "Make the weekly calendar easier to scan.",
				heading: "Weekly calendar updated",
				body: "Appointments now keep their labels visible as the calendar changes width.",
				detail:
					"The layout handles both quiet weeks and days with several bookings.",
				file: "Calendar.tsx",
				kind: "3 files changed",
			},
		],
	},
	{
		id: "research",
		name: "Essay research",
		panes: [
			{
				ai: "gemini",
				title: "Research notes",
				status: "Ready",
				context: "56k",
				prompt: "Find a useful structure for these research notes.",
				heading: "Three themes to explore",
				body: "The notes suggest three distinct themes. Each has enough evidence to develop without repeating the others.",
				detail: "Start with the theme most closely connected to your question.",
				file: "Research notes.md",
				kind: "Notes organized",
			},
		],
	},
	{
		id: "filtr",
		name: "Filtrsoft",
		panes: [
			{
				ai: "codex",
				title: "Queue reliability",
				status: "Working",
				context: "118k",
				prompt: "Review how queued work recovers after a restart.",
				heading: "Recovery checks in progress",
				body: "The queue retains pending tasks and resumes them in order. Completed work is kept separate from retries.",
				detail:
					"I’m checking the handoff when the connection drops during an operation.",
				file: "queue.test.ts",
				kind: "Running checks",
			},
		],
	},
	{
		id: "design",
		name: "Design review",
		panes: [
			{
				ai: "claude",
				title: "Interface review",
				status: "Ready",
				context: "67k",
				prompt: "Review the smaller interface details.",
				heading: "Make the useful parts easier to see",
				body: "The compact session list leaves more space for names. Status, owner, and project stay readable at a glance.",
				detail:
					"The navigation needs no extra row of controls; the hover preview provides detail on demand.",
				file: "Interface notes.md",
				kind: "Review ready",
			},
		],
	},
];
const extras = [
	"Sortie",
	"Resume revision v7",
	"Study notes",
	"Component design system",
	"Mobile",
	"Research plan",
	"Project notebook",
	"Website polish",
	"Reading notes",
	"Weekly planning",
];
let tabs = structuredClone(examples),
	selected = "workspace",
	focused = 0,
	hoverId = null,
	scale = 1;
let openTimer,
	closeTimer,
	toastTimer,
	demoTimer,
	dragId = null;
const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
const icon = (n) =>
	`<i data-icon="${n}" style="--icon:url('${window.TOPBAR_ICONS[n]}')" aria-hidden="true"></i>`;
const logo = (ai) => `<img src="assets/${ai}.svg" alt="${names[ai]}">`;
const short = (s) =>
	Array.from(s).length > 15 ? `${Array.from(s).slice(0, 15).join("")}...` : s;
function notify(message) {
	clearTimeout(toastTimer);
	$("#toast").textContent = message;
	$("#toast").classList.add("visible");
	toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2400);
}
function size() {
	const stage = $("#stage"),
		app = $("#app");
	const width = Math.max(1180, stage.clientWidth);
	scale = Math.min(1, stage.clientWidth / width);
	app.style.width = `${width}px`;
	app.style.height = `${stage.clientHeight / scale}px`;
	app.style.transform = `scale(${scale})`;
	const wing = Math.max(
		$(".left-tools").offsetWidth + 36,
		$(".right-tools").offsetWidth + 36,
	);
	$("#rail").style.setProperty("--available", `${width - wing * 2}px`);
	updateOverflow();
	if (hoverId) positionCard();
}
function updateOverflow() {
	const list = $("#tabs");
	const over = list.scrollWidth > list.clientWidth + 2;
	$(".rail-end").dataset.overflow = String(over);
	for (const el of $$(".arrow")) el.hidden = !over;
	$("#previous").disabled = list.scrollLeft < 2;
	$("#next").disabled =
		list.scrollLeft + list.clientWidth >= list.scrollWidth - 2;
}
function renderTabs() {
	$("#tabs").innerHTML = tabs
		.map(
			(tab) =>
				`<div class="tab-slot ${tab.id === selected ? "active" : ""}" data-id="${tab.id}" style="--selected-width:${Math.max(130, Math.min(208, short(tab.name).length * 7.2 + 78))}px"><div class="tab-face">${logo(tab.panes[0].ai)}${tab.id === selected ? `<span class="tab-title">${esc(short(tab.name))}</span>${tab.panes.length > 1 ? `<span class="tab-pane-count">${tab.panes.length}</span>` : ""}` : ""}${tab.panes.some((p) => p.status === "Working") ? '<span class="tab-status working"></span>' : ""}</div><button class="tab-hit" type="button" role="tab" aria-selected="${tab.id === selected}" tabindex="${tab.id === selected ? 0 : -1}" aria-label="${esc(tab.name)}"></button></div>`,
		)
		.join("");
	renderRecent();
	size();
	requestAnimationFrame(updateOverflow);
}
function renderRecent() {
	const query = $("#session-search").value.toLowerCase();
	$("#count").textContent = tabs.length;
	$("#session-list").innerHTML = tabs
		.filter((t) =>
			`${t.name} ${t.panes.map((p) => p.title).join(" ")}`
				.toLowerCase()
				.includes(query),
		)
		.map(
			(tab) =>
				`<button class="session-row ${tab.id === selected ? "active" : ""}" draggable="true" data-select="${tab.id}" aria-label="Open ${esc(tab.name)}">${logo(tab.panes[0].ai)}<div><strong>${esc(tab.name)}</strong><small>${tab.panes.length > 1 ? `${tab.panes.length} panes · ${[...new Set(tab.panes.map((p) => names[p.ai]))].join(" + ")}` : names[tab.panes[0].ai]}</small></div><span>${tab.panes.some((p) => p.status === "Working") ? "Now" : "2h"}</span></button>`,
		)
		.join("");
}
function renderPanes() {
	const tab = tabs.find((t) => t.id === selected);
	$("#panes").innerHTML = tab.panes
		.map(
			(p, i) =>
				`<section class="pane ${focused === i ? "focused" : ""}" data-pane="${i}"><header class="pane-header">${icon("Folder")}${logo(p.ai)}<strong>${esc(p.title)}</strong><span class="context">${p.context}</span>${icon("Ellipsis")}${icon("Maximize2")}</header><div class="account">${logo(p.ai)}${names[p.ai]} · Yish</div><div class="transcript"><div class="prompt">${esc(p.prompt)}</div><h3>${esc(p.heading)}</h3><p>${esc(p.body)}</p><p>${esc(p.detail)}</p><div class="artifact">${icon("Code")}<span>${esc(p.file)}</span><small>${esc(p.kind)}</small></div><div class="status"><span class="dot ${p.status === "Working" ? "working" : ""}"></span>${p.status === "Working" ? "Working · In progress" : "Complete · Ready for your next message"}</div></div><form class="composer"><textarea rows="2" aria-label="Message ${names[p.ai]} in ${esc(p.title)}" placeholder="Ask to make changes, /commands, or $skills…"></textarea><div class="composer-controls"><button type="button" class="icon" data-note="Preview only: attachments stay in your existing composer." aria-label="Attach a file">${icon("Plus")}</button><span></span><button type="button" class="icon" data-note="Your existing model and effort menu stays unchanged." aria-label="Model and effort">${icon("Brain")}</button><button type="button" class="icon" data-note="Your existing permissions menu stays unchanged." aria-label="Permissions">${icon("Shield")}</button><button type="button" class="icon" data-note="Flow is not started in this preview." aria-label="Voice dictation">${icon("Mic")}</button><button class="send" type="submit" aria-label="Send simulated message">${icon("ArrowUp")}</button></div></form></section>`,
		)
		.join("");
}
function select(id, index = 0) {
	hidePreview();
	selected = id;
	focused = index;
	renderTabs();
	renderPanes();
	const el = $(`.tab-slot[data-id="${id}"]`);
	el?.scrollIntoView({ block: "nearest", inline: "nearest" });
	notify(
		index
			? `${names[tabs.find((t) => t.id === id).panes[index].ai]} pane selected`
			: `${tabs.find((t) => t.id === id).name} selected`,
	);
}
function hidePreview() {
	clearTimeout(openTimer);
	clearTimeout(closeTimer);
	hoverId = null;
	$("#hover-preview").hidden = true;
	for (const el of $$(".tab-slot")) el.dataset.hover = "false";
}
function delayHide() {
	clearTimeout(closeTimer);
	clearTimeout(openTimer);
	closeTimer = setTimeout(hidePreview, 260);
}
function positionCard() {
	const target = $(`.tab-slot[data-id="${hoverId}"]`),
		card = $("#hover-preview");
	if (!target) return;
	const rect = target.getBoundingClientRect(),
		origin = $("#app").getBoundingClientRect(),
		x = (rect.left + rect.width / 2 - origin.left) / scale;
	card.style.left = `${Math.max(12, Math.min($("#app").offsetWidth - card.offsetWidth - 12, x - card.offsetWidth / 2))}px`;
	card.style.top = `${($("#rail").getBoundingClientRect().bottom - origin.top) / scale + 12}px`;
	card.style.transformOrigin = `${x - parseFloat(card.style.left)}px 0`;
}
function showPreview(id) {
	clearTimeout(closeTimer);
	if (id === hoverId) return;
	const tab = tabs.find((t) => t.id === id);
	if (!tab) return;
	hidePreview();
	hoverId = id;
	$(`.tab-slot[data-id="${id}"]`).dataset.hover = "true";
	const card = $("#hover-preview");
	card.innerHTML = `<header class="preview-header">${logo(tab.panes[0].ai)}<strong>${esc(tab.name)}</strong><span></span><button type="button" data-close-preview aria-label="Dismiss preview">${icon("X")}</button></header>
<button type="button" class="tab-thumbnail" data-open-preview aria-label="Open ${esc(tab.name)} workspace"><div class="mini-layout" style="--pane-count:${tab.panes.length}">${tab.panes.map((p, i) => `<div class="mini-pane" data-mini-pane="${i}"><div class="mini-header">${logo(p.ai)}<span>${esc(p.title)}</span></div><div class="miniature"><div class="mini-content" style="--mini-scale:${(316 - (tab.panes.length - 1) * 4) / tab.panes.length / 500}"><div class="mini-prompt">${esc(p.prompt)}</div><h3>${esc(p.heading)}</h3><p>${esc(p.body)}</p><p>${esc(p.detail)}</p></div></div><div class="mini-composer"><span></span><b>↑</b></div></div>`).join("")}</div></button>`;
	card.hidden = false;
	positionCard();
	if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
		card.animate(
			[
				{ opacity: 0, transform: "translateY(-3px) scale(.99)" },
				{ opacity: 1, transform: "translateY(0) scale(1)" },
			],
			{ duration: 160, easing: "cubic-bezier(.16,1,.3,1)" },
		);
}
$("#tabs").addEventListener("pointerover", (e) => {
	const tab = e.target.closest(".tab-slot");
	if (!tab || tab.contains(e.relatedTarget)) return;
	clearTimeout(openTimer);
	clearTimeout(closeTimer);
	openTimer = setTimeout(() => showPreview(tab.dataset.id), 160);
});
$("#rail").addEventListener("pointerleave", delayHide);
$("#hover-preview").addEventListener("pointerenter", () =>
	clearTimeout(closeTimer),
);
$("#hover-preview").addEventListener("pointerleave", delayHide);
$("#tabs").addEventListener("focusin", (e) => {
	const tab = e.target.closest(".tab-slot");
	if (tab) showPreview(tab.dataset.id);
});
$("#tabs").addEventListener("keydown", (e) => {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
	e.preventDefault();
	const buttons = $$(".tab-hit");
	const at = buttons.indexOf(document.activeElement);
	const next =
		e.key === "Home"
			? 0
			: e.key === "End"
				? buttons.length - 1
				: (at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) %
					buttons.length;
	buttons[next].focus();
	buttons[next].scrollIntoView({ block: "nearest", inline: "nearest" });
});
$("#tabs").addEventListener("click", (e) => {
	const tab = e.target.closest(".tab-slot");
	if (tab) select(tab.dataset.id);
});
$("#tabs").addEventListener(
	"wheel",
	(e) => {
		if (e.deltaY && $("#tabs").scrollWidth > $("#tabs").clientWidth) {
			e.preventDefault();
			$("#tabs").scrollLeft += e.deltaY;
		}
	},
	{ passive: false },
);
$("#tabs").addEventListener("scroll", () => {
	hidePreview();
	updateOverflow();
});
$("#previous").onclick = () => {
	$("#tabs").scrollLeft -= 170;
};
$("#next").onclick = () => {
	$("#tabs").scrollLeft += 170;
};
$("#hover-preview").addEventListener("click", (e) => {
	if (e.target.closest("[data-close-preview]")) hidePreview();
	if (e.target.closest("[data-open-preview]")) select(hoverId);
});
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		hidePreview();
		clearTimeout(demoTimer);
		$("#demo-pointer").hidden = true;
	}
});
$("#panes").addEventListener("click", (e) => {
	const note = e.target.closest("[data-note]");
	if (note) notify(note.dataset.note);
	const pane = e.target.closest("[data-pane]");
	if (pane) {
		focused = Number(pane.dataset.pane);
		for (const p of $$(".pane")) p.classList.toggle("focused", p === pane);
	}
});
$("#panes").addEventListener("submit", (e) => {
	e.preventDefault();
	const input = e.target.querySelector("textarea");
	if (!input.value.trim()) return;
	const message = document.createElement("div");
	message.className = "prompt";
	message.textContent = input.value;
	e.target.closest(".pane").querySelector(".transcript").append(message);
	input.value = "";
	notify("Preview message only · no AI session contacted");
});
$("#session-list").addEventListener("click", (e) => {
	if (dragId) return;
	const row = e.target.closest("[data-select]");
	if (row) select(row.dataset.select);
});
$("#session-list").addEventListener("dragstart", (e) => {
	const row = e.target.closest("[data-select]");
	if (!row) return;
	dragId = row.dataset.select;
	e.dataTransfer.setData("text/plain", dragId);
	e.dataTransfer.effectAllowed = "move";
	row.classList.add("dragging");
	hidePreview();
});
$("#session-list").addEventListener("dragover", (e) => {
	if (!dragId) return;
	e.preventDefault();
	for (const row of $$(".session-row")) row.classList.remove("drag-over");
	e.target.closest(".session-row")?.classList.add("drag-over");
});
$("#session-list").addEventListener("drop", (e) => {
	e.preventDefault();
	const row = e.target.closest("[data-select]");
	if (row && dragId && row.dataset.select !== dragId) {
		const from = tabs.findIndex((t) => t.id === dragId),
			target = tabs.findIndex((t) => t.id === row.dataset.select);
		const [tab] = tabs.splice(from, 1);
		tabs.splice(target, 0, tab);
		renderTabs();
		notify("Reordered from the whole row");
	}
	dragId = null;
});
$("#session-list").addEventListener("dragend", () => {
	dragId = null;
	for (const row of $$(".session-row"))
		row.classList.remove("dragging", "drag-over");
});
$("#session-search").oninput = renderRecent;
$("#search-button").onclick = () => $("#session-search").focus();
$("#toggle-sidebar").onclick = () => {
	$("#sidebar").classList.toggle("collapsed");
};
$("#build").onclick = () =>
	notify(
		"Installer status stays compact. No build is running in this preview.",
	);
function setCount(count) {
	hidePreview();
	tabs = structuredClone(examples);
	while (tabs.length < count) {
		const n = tabs.length - 6;
		const tab = structuredClone(examples[n % examples.length]);
		tab.id = `extra-${n}`;
		tab.name = extras[n % extras.length];
		tab.panes = tab.panes.slice(0, 1);
		tabs.push(tab);
	}
	tabs = tabs.slice(0, count);
	if (!tabs.some((t) => t.id === selected)) selected = tabs[0].id;
	focused = 0;
	for (const b of $$("[data-count]"))
		b.setAttribute("aria-pressed", String(Number(b.dataset.count) === count));
	renderTabs();
	renderPanes();
}
for (const button of $$("[data-count]"))
	button.onclick = () => setCount(Number(button.dataset.count));
$("#new-tab").onclick = () => {
	setCount(tabs.length + 1);
	notify("Added a sample tab");
};
$("#reset").onclick = () => {
	clearTimeout(demoTimer);
	$("#demo-pointer").hidden = true;
	$("#session-search").value = "";
	selected = "workspace";
	setCount(6);
};
$("#demo").onclick = () => {
	clearTimeout(demoTimer);
	let step = 0;
	const ids = ["college", "calc", "research", "workspace"];
	const tick = () => {
		const id = ids[step++];
		if (!id) {
			hidePreview();
			$("#demo-pointer").hidden = true;
			return;
		}
		const node = $(`.tab-slot[data-id="${id}"]`);
		if (!node) return;
		node.scrollIntoView({ block: "nearest", inline: "nearest" });
		const rect = node.getBoundingClientRect(),
			origin = $("#app").getBoundingClientRect();
		const pointer = $("#demo-pointer");
		pointer.hidden = false;
		pointer.style.left = `${(rect.left + rect.width / 2 - origin.left) / scale}px`;
		pointer.style.top = `${(rect.top + rect.height / 2 - origin.top) / scale}px`;
		// Let the scroll event settle before opening; scrolling dismisses cards.
		demoTimer = setTimeout(() => {
			showPreview(id);
			demoTimer = setTimeout(tick, 2200);
		}, 50);
	};
	notify("Demo pointer only · your cursor is unchanged");
	tick();
};
for (const node of $$("i[data-icon]"))
	node.style.setProperty(
		"--icon",
		`url('${window.TOPBAR_ICONS[node.dataset.icon]}')`,
	);
renderTabs();
renderPanes();
new ResizeObserver(size).observe($("#stage"));
