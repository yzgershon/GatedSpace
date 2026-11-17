// Standalone, local design preview. No Electron, provider, or account calls.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const app = $("#app");
const list = $("#tabs");
const rail = $("#tab-rail");
const popover = $("#popover");
const providers = { codex: "Codex", claude: "Claude", gemini: "Gemini" };
const initial = [
	{
		id: "gs",
		name: "GS Edits",
		provider: "codex",
		project: "GatedSpace",
		status: "idle",
		panes: 2,
	},
	{
		id: "college",
		name: "College",
		provider: "claude",
		project: "College",
		status: "working",
		panes: 3,
	},
	{
		id: "calc",
		name: "Calc Biz",
		provider: "codex",
		project: "Calc Biz",
		status: "idle",
	},
	{
		id: "research",
		name: "Essay research",
		provider: "gemini",
		project: "College",
		status: "done",
	},
	{
		id: "filtr",
		name: "Filtrsoft",
		provider: "codex",
		project: "Filtrsoft",
		status: "idle",
	},
	{
		id: "design",
		name: "Design review",
		provider: "claude",
		project: "GatedSpace",
		status: "idle",
	},
	{
		id: "sortie",
		name: "Sortie",
		provider: "codex",
		project: "Sortie",
		status: "done",
	},
];
initial.push(
	{
		id: "resume",
		name: "Resume revision v7",
		provider: "claude",
		project: "College",
		status: "idle",
	},
	{
		id: "study",
		name: "Study notes",
		provider: "gemini",
		project: "School",
		status: "idle",
	},
	{
		id: "design-system",
		name: "Component design system",
		provider: "codex",
		project: "GatedSpace",
		status: "idle",
	},
);
let tabs = structuredClone(initial);
let selected = "gs";
let expanded = selected;
let hoverId = null;
let demoTimer = null;
let buildTimer = null;
let hoverTimer;
let toastTimer;
let moveX = null;
let moveY = null;
let sequence = 0;
let scale = 1;
let dragged = null;
let suppressClickUntil = 0;
let popoverKind = null;
let popoverAnchor = null;
const drafts = new Map();
const messages = new Map();
const escapeHtml = (text) =>
	String(text).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
const icon = (name) =>
	`<i data-icon="${name}" aria-hidden="true" style="--icon:url('${window.TOPBAR_ICONS[name]}')"></i>`;
function hydrateIcons() {
	for (const node of $$("i[data-icon]")) {
		node.style.setProperty(
			"--icon",
			`url('${window.TOPBAR_ICONS[node.dataset.icon]}')`,
		);
		node.setAttribute("aria-hidden", "true");
	}
}
function notify(message) {
	clearTimeout(toastTimer);
	$("#toast").textContent = message;
	$("#toast").classList.add("visible");
	toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2800);
}
function sizePreview() {
	const stage = $("#stage");
	const widthChoice = $("#preview-width").value;
	const width =
		widthChoice === "auto"
			? Math.max(1100, stage.clientWidth)
			: Number(widthChoice);
	scale = Math.min(1, stage.clientWidth / width);
	app.style.width = `${width}px`;
	app.style.height = `${stage.clientHeight / scale}px`;
	app.style.left = `${Math.max(0, (stage.clientWidth - width * scale) / 2)}px`;
	app.style.transform = `scale(${scale})`;
	app.dataset.narrow = String(width < 1250);
	const wing = Math.max(
		$("#left-cluster").offsetWidth + 28,
		$("#right-cluster").offsetWidth + 28,
	);
	rail.style.maxWidth =
		app.dataset.layout === "proposed" ? `${width - wing * 2}px` : "";
	rail.style.setProperty(
		"--rail-width",
		`${Math.min(10, tabs.length) * 48 + 250}px`,
	);
	requestAnimationFrame(updateOverflow);
	if (!popover.hidden) positionPopover();
}
function updateOverflow() {
	const hasLeft = list.scrollLeft > 2;
	const hasRight = list.scrollLeft + list.clientWidth < list.scrollWidth - 2;
	$("#previous").disabled = !hasLeft;
	$("#next").disabled = !hasRight;
	$("#tab-window").style.setProperty("--fade-left", hasLeft ? "13px" : "0px");
	$("#tab-window").style.setProperty("--fade-right", hasRight ? "13px" : "0px");
}
function setExpanded(id) {
	if (app.dataset.hover === "stable") {
		showHoverCard(id);
		id = selected;
	}
	expanded = id;
	for (const el of $$(".session-tab")) {
		el.classList.toggle("expanded", el.dataset.id === id);
		el.querySelector(".tab-close").tabIndex =
			el.dataset.id === selected && el.dataset.id === id ? 0 : -1;
	}
	requestAnimationFrame(updateOverflow);
}
function ensureVisible(id) {
	const el = list.querySelector(`[data-id="${id}"]`);
	if (!el) return;
	const start = el.offsetLeft;
	if (start < list.scrollLeft) list.scrollLeft = start;
	else if (start + el.offsetWidth > list.scrollLeft + list.clientWidth)
		list.scrollLeft = start + el.offsetWidth - list.clientWidth;
	updateOverflow();
}
function renderTabs() {
	list.innerHTML = tabs
		.map(
			(
				tab,
			) => `<div class="session-tab ${tab.id === selected ? "active" : ""} ${tab.id === expanded ? "expanded" : ""}" data-id="${tab.id}">
    <button type="button" class="tab-select" role="tab" aria-selected="${tab.id === selected}" aria-label="${escapeHtml(tab.name)}, ${providers[tab.provider]}, ${tab.status}" tabindex="${tab.id === selected ? 0 : -1}">
      <span class="tab-logo" data-status="${tab.status}"><img src="assets/${tab.provider}.svg" alt=""></span><span class="tab-label">${escapeHtml(Array.from(tab.name).length > 15 ? `${Array.from(tab.name).slice(0, 15).join("")}...` : tab.name)}${tab.panes ? `<span class="tab-number">${tab.panes}</span>` : ""}</span>
    </button><button type="button" class="tab-close" aria-label="Close ${escapeHtml(tab.name)}" tabindex="${tab.id === selected && tab.id === expanded ? 0 : -1}">${icon("X")}</button>
  </div>`,
		)
		.join("");
	$("#all-tabs").textContent = tabs.length;
	$("#all-tabs").title = `All ${tabs.length} sessions`;
	$("#pinned-count").textContent = tabs.length;
	$("#session-list").innerHTML = tabs
		.map(
			(tab) =>
				`<button type="button" class="session-row ${tab.id === selected ? "active" : ""}" data-select="${tab.id}"><img src="assets/${tab.provider}.svg" alt=""><div><strong>${escapeHtml(tab.name)}</strong><small>${providers[tab.provider]} · ${escapeHtml(tab.project)}</small></div><span>${tab.status === "working" ? "Active" : "2h"}</span></button>`,
		)
		.join("");
	sizePreview();
}
const sample = {
	gs: [
		"Give the session tabs more space, and keep every hover target still.",
		"The sessions are now the focus of the top bar.",
		"The floating tabs sit in the center of the window. The selected title stays visible, and hover reveals a name card without shifting any click targets.",
		"Hover to reveal a title, click to switch, or drag a tab to reorder it. The rest of your workspace stays familiar.",
	],
	college: [
		"Review the introduction and keep the essay in my own voice.",
		"IÃ¢â‚¬â„¢m checking the transition into the opening story.",
		"The strongest part is the specific moment you chose. IÃ¢â‚¬â„¢m keeping that intact and looking for places where the explanation repeats what the scene already shows.",
		"The next pass will focus on the final paragraph and the connection to your chosen subject.",
	],
	calc: [
		"Check the assumptions in the pricing model.",
		"The base case is ready for review.",
		"The sheet now separates fixed costs from costs that change with each order. That makes it easier to compare price points without hiding the assumptions.",
		"Next, we can test how the result changes when demand is lower than expected.",
	],
	research: [
		"Help me organize the sources for my essay.",
		"The source notes are organized by claim.",
		"Each note has a source, a short explanation of what it supports, and the question it leaves open. The outline keeps your own argument separate from the quotations.",
		"Open any source note to check the evidence before using it in the draft.",
	],
};
function renderConversation() {
	const tab = tabs.find((t) => t.id === selected);
	if (!tab) return;
	$("#pane-title").textContent = tab.name;
	$("#pane-agent").src = `assets/${tab.provider}.svg`;
	$("#pane-agent").alt = providers[tab.provider];
	$("#account-line").textContent = `${providers[tab.provider]} · Yish`;
	$("#pane-context").textContent = tab.id.startsWith("new-") ? "" : "128k";
	const content = sample[tab.id];
	if (content) {
		$("#conversation").innerHTML =
			`<div class="user-message">${content[0]}</div><div class="assistant-message"><p>${content[1]}</p><p>${content[2]}</p><p>${content[3]}</p><div class="message-meta"><span class="status-dot"></span>${tab.status === "working" ? "Working · Reviewing the draft" : "Complete · Ready for your next message"}</div>${tab.id === "gs" ? '<div class="file-summary">2 files changed <span>+86</span> −24</div>' : ""}</div>`;
	} else {
		$("#conversation").innerHTML =
			`<div class="assistant-message"><p>${tab.id.startsWith("new-") ? `New ${providers[tab.provider]} session` : escapeHtml(tab.name)}</p><p>${tab.id.startsWith("new-") ? "This session was opened by the compact agent shortcut. Try another agent or return to one of your other tabs." : "Your conversation and work stay here when you switch between tabs."}</p><div class="message-meta">Simulated session · No provider connected</div></div>`;
	}
	for (const message of messages.get(tab.id) || []) appendMessage(message);
	$("#prompt").value = drafts.get(tab.id) || "";
}
function selectTab(id, focus = false) {
	hideHoverCard();
	clearTimeout(hoverTimer);
	drafts.set(selected, $("#prompt").value);
	selected = id;
	expanded = id;
	const tab = tabs.find((t) => t.id === id);
	if (tab.status === "done") tab.status = "idle";
	closePopover();
	renderTabs();
	renderConversation();
	if (focus) {
		list
			.querySelector(`[data-id="${id}"] .tab-select`)
			.focus({ preventScroll: true });
	}
	requestAnimationFrame(() => {
		ensureVisible(id);
	});
}
function closeTab(id) {
	const index = tabs.findIndex((t) => t.id === id);
	tabs = tabs.filter((t) => t.id !== id);
	drafts.delete(id);
	messages.delete(id);
	if (tabs.length === 0) {
		addTab("codex");
		return;
	}
	if (selected === id) selectTab(tabs[Math.min(index, tabs.length - 1)].id);
	else {
		expanded = selected;
		renderTabs();
	}
}
function addTab(provider) {
	const id = `new-${++sequence}`;
	tabs.push({
		id,
		name: `${providers[provider]} session`,
		provider,
		project: "GatedSpace",
		status: "idle",
	});
	selectTab(id);
	notify(`${providers[provider]} session opened in the preview`);
}
function closePopover() {
	popover.hidden = true;
	popoverKind = null;
	if (popoverAnchor) popoverAnchor.setAttribute("aria-expanded", "false");
}
function positionPopover() {
	const anchor = popoverAnchor.getBoundingClientRect();
	const appRect = app.getBoundingClientRect();
	popover.style.left = `${Math.max(12, Math.min(app.clientWidth - popover.offsetWidth - 12, (anchor.left - appRect.left) / scale))}px`;
	popover.style.top = `${Math.min(app.clientHeight - popover.offsetHeight - 14, (anchor.bottom - appRect.top) / scale + 9)}px`;
}
function showPopover(kind, anchor) {
	if (popoverKind === kind && !popover.hidden) {
		closePopover();
		return;
	}
	popoverKind = kind;
	popoverAnchor = anchor;
	anchor.setAttribute("aria-expanded", "true");
	popover.hidden = false;
	if (kind === "new") {
		popover.innerHTML = `<h2>New session</h2>${Object.entries(providers)
			.map(
				([id, name]) =>
					`<button type="button" class="menu-row" data-launch="${id}"><img src="assets/${id}.svg" alt=""><div><span>${name}</span><small>Start in this workspace</small></div>${icon("Plus")}</button>`,
			)
			.join("")}`;
	} else if (kind === "builds") {
		popover.innerHTML = `<h2>Installer builds · Sample state</h2>${["Personal ARM64", "Public x64", "Public ARM64"].map((name) => `<div class="menu-row">${icon("Check")}<div><span>${name}</span><small>1.18.57 · Ready</small></div></div>`).join("")}`;
	} else {
		popover.innerHTML =
			'<h2>Open sessions</h2><input aria-label="Find a session" placeholder="Search sessions…" autocomplete="off"><div id="search-results"></div>';
		renderSearch("");
		popover
			.querySelector("input")
			.addEventListener("input", (e) => renderSearch(e.target.value));
		requestAnimationFrame(() => popover.querySelector("input")?.focus());
	}
	positionPopover();
}
function renderSearch(query) {
	const matches = tabs.filter((t) =>
		`${t.name} ${providers[t.provider]} ${t.project}`
			.toLowerCase()
			.includes(query.toLowerCase()),
	);
	$("#search-results").innerHTML =
		matches
			.map(
				(tab) =>
					`<button type="button" class="menu-row" data-select="${tab.id}"><img src="assets/${tab.provider}.svg" alt=""><div><span>${escapeHtml(tab.name)}</span><small>${providers[tab.provider]} · ${escapeHtml(tab.project)}</small></div>${selected === tab.id ? icon("Check") : ""}</button>`,
			)
			.join("") || '<p class="empty">No matching sessions</p>';
}
list.addEventListener("click", (event) => {
	if (Date.now() < suppressClickUntil) return;
	const el = event.target.closest(".session-tab");
	if (!el) return;
	if (event.target.closest(".tab-close")) closeTab(el.dataset.id);
	else selectTab(el.dataset.id);
});
// Only physical pointer movement changes the hover target. Layout motion cannot
// cause the newly expanded tab to repeatedly collapse beneath a stationary mouse.
list.addEventListener("pointermove", (event) => {
	if (dragged || (event.clientX === moveX && event.clientY === moveY)) return;
	moveX = event.clientX;
	moveY = event.clientY;
	const el = event.target.closest(".session-tab");
	if (
		!el ||
		el.dataset.id === (app.dataset.hover === "stable" ? hoverId : expanded)
	)
		return;
	clearTimeout(hoverTimer);
	hoverTimer = setTimeout(() => setExpanded(el.dataset.id), 120);
});
rail.addEventListener("pointerleave", () => {
	hideHoverCard();
	clearTimeout(hoverTimer);
	if (!dragged) hoverTimer = setTimeout(() => setExpanded(selected), 170);
});
list.addEventListener("focusin", (event) => {
	clearTimeout(hoverTimer);
	const el = event.target.closest(".session-tab");
	if (el) setExpanded(el.dataset.id);
});
list.addEventListener("keydown", (event) => {
	if (!["ArrowLeft", "ArrowRight", "Home", "End", "Delete"].includes(event.key))
		return;
	event.preventDefault();
	const index = tabs.findIndex((t) => t.id === selected);
	if (event.key === "Delete") {
		closeTab(selected);
		return;
	}
	if (event.altKey && event.key.startsWith("Arrow")) {
		const next = Math.max(
			0,
			Math.min(tabs.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)),
		);
		const [tab] = tabs.splice(index, 1);
		tabs.splice(next, 0, tab);
		selectTab(tab.id, true);
		notify(`${tab.name} moved to position ${next + 1}`);
		return;
	}
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? tabs.length - 1
				: (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
					tabs.length;
	selectTab(tabs[next].id, true);
});
list.addEventListener("pointerdown", (event) => {
	if (event.button !== 0 || event.target.closest(".tab-close")) return;
	const el = event.target.closest(".session-tab");
	if (!el) return;
	clearTimeout(hoverTimer);
	dragged = {
		id: el.dataset.id,
		start: event.clientX,
		pointerId: event.pointerId,
		active: false,
		target: null,
		after: false,
	};
});
document.addEventListener("pointermove", (event) => {
	if (!dragged || event.pointerId !== dragged.pointerId) return;
	if (!dragged.active && Math.abs(event.clientX - dragged.start) > 7) {
		dragged.active = true;
		list.setPointerCapture(event.pointerId);
		list.querySelector(`[data-id="${dragged.id}"]`)?.classList.add("dragging");
	}
	if (!dragged.active) return;
	const candidates = $$(".session-tab").filter(
		(node) => node.dataset.id !== dragged.id,
	);
	for (const node of candidates) node.classList.remove("drop-before");
	const before = candidates.find((node) => {
		const r = node.getBoundingClientRect();
		return event.clientX < r.left + r.width / 2;
	});
	dragged.target = before?.dataset.id ?? candidates.at(-1)?.dataset.id;
	dragged.after = !before;
	before?.classList.add("drop-before");
	const bounds = list.getBoundingClientRect();
	if (event.clientX < bounds.left + 25) list.scrollLeft -= 9;
	if (event.clientX > bounds.right - 25) list.scrollLeft += 9;
});
function finishDrag(cancel = false) {
	if (!dragged) return;
	const drag = dragged;
	dragged = null;
	if (list.hasPointerCapture(drag.pointerId))
		list.releasePointerCapture(drag.pointerId);
	if (!drag.active) return;
	suppressClickUntil = Date.now() + 200;
	if (!cancel && drag.target) {
		const [tab] = tabs.splice(
			tabs.findIndex((t) => t.id === drag.id),
			1,
		);
		const index = tabs.findIndex((t) => t.id === drag.target);
		tabs.splice(index + (drag.after ? 1 : 0), 0, tab);
		notify(`${tab.name} moved`);
	}
	expanded = selected;
	renderTabs();
}
document.addEventListener("pointerup", () => finishDrag());
document.addEventListener("pointercancel", () => finishDrag(true));
window.addEventListener("blur", () => finishDrag(true));
list.addEventListener(
	"scroll",
	() => {
		hideHoverCard();
		updateOverflow();
	},
	{ passive: true },
);
list.addEventListener("transitionend", updateOverflow);
$("#previous").onclick = () =>
	list.scrollBy({
		left: -200,
		behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
			? "instant"
			: "smooth",
	});
$("#next").onclick = () =>
	list.scrollBy({
		left: 200,
		behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
			? "instant"
			: "smooth",
	});
$("#add-tab").onclick = (e) => showPopover("new", e.currentTarget);
$("#pane-add").onclick = (e) => showPopover("new", e.currentTarget);
$("#search").onclick = (e) => showPopover("search", e.currentTarget);
$("#sidebar-search").onclick = () => showPopover("search", $("#search"));
$("#all-tabs").onclick = (e) => showPopover("search", e.currentTarget);
$("#build-status").onclick = (e) => showPopover("builds", e.currentTarget);
document.addEventListener("click", (event) => {
	const launch = event.target.closest("[data-launch]");
	const select = event.target.closest("[data-select]");
	const note = event.target.closest("[data-note]");
	const windowButton = event.target.closest("[data-window]");
	const sidebarButton = event.target.closest("[data-sidebar]");
	if (launch) addTab(launch.dataset.launch);
	if (select) selectTab(select.dataset.select);
	if (note) notify(note.dataset.note);
	if (windowButton)
		notify(
			`${windowButton.dataset.window} is only a preview; your window is unchanged.`,
		);
	if (sidebarButton) {
		for (const el of $$("[data-sidebar]")) {
			el.classList.toggle("chosen", el === sidebarButton);
		}
		notify(`${sidebarButton.dataset.sidebar} · Top bar design preview`);
	}
	if (
		!popover.hidden &&
		!popover.contains(event.target) &&
		!popoverAnchor?.contains(event.target)
	)
		closePopover();
});
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		finishDrag(true);
		const anchor = popoverAnchor;
		closePopover();
		anchor?.focus();
	}
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		showPopover("search", $("#search"));
	}
});
$("#sidebar-toggle").onclick = () => {
	const closed = app.dataset.sidebar !== "closed";
	app.dataset.sidebar = closed ? "closed" : "open";
	$("#sidebar-toggle").setAttribute("aria-pressed", String(!closed));
};
for (const button of $$("[data-layout-choice]"))
	button.onclick = () => {
		closePopover();
		app.dataset.layout = button.dataset.layoutChoice;
		for (const item of $$("[data-layout-choice]"))
			item.setAttribute("aria-pressed", String(item === button));
		sizePreview();
	};
$("#preview-width").onchange = sizePreview;
$("#stress-tabs").onclick = () => {
	const extra = [
		"Research notes",
		"Landing page",
		"API cleanup",
		"Writing feedback",
		"Physics",
		"Portfolio",
		"Bug investigation",
		"Planning",
		"Reading list",
	];
	for (const [index, name] of extra.entries()) {
		if (tabs.length >= 16) break;
		const id = `extra-${index}`;
		if (!tabs.some((tab) => tab.id === id))
			tabs.push({
				id,
				name,
				provider: ["claude", "codex", "gemini"][index % 3],
				project: "Dev",
				status: "idle",
			});
	}
	renderTabs();
	notify("More tabs added. Try the arrows or the session list.");
};
function appendMessage(message) {
	const node = document.createElement("div");
	node.className = "user-message";
	node.textContent = message;
	$("#conversation").appendChild(node);
}
$("#composer").onsubmit = (event) => {
	event.preventDefault();
	const value = $("#prompt").value.trim();
	if (!value) return;
	const history = messages.get(selected) || [];
	history.push(value);
	messages.set(selected, history);
	appendMessage(value);
	$("#prompt").value = "";
	drafts.set(selected, "");
	$("#conversation").scrollTop = $("#conversation").scrollHeight;
	notify("Preview message only. Nothing sent to an agent.");
};
$("#reset").onclick = () => {
	closePopover();
	clearTimeout(demoTimer);
	clearTimeout(hoverTimer);
	clearInterval(buildTimer);
	hideHoverCard();
	$("#demo-pointer").hidden = true;
	$("#build-status").innerHTML = icon("Check");
	$("#build-status").title = "Demo installer ready";
	tabs = structuredClone(initial);
	selected = "gs";
	expanded = "gs";
	drafts.clear();
	messages.clear();
	app.dataset.layout = "proposed";
	app.dataset.hover = "stable";
	for (const button of $$("[data-hover-choice]"))
		button.setAttribute(
			"aria-pressed",
			String(button.dataset.hoverChoice === "stable"),
		);
	$("#physics-status").textContent = "Targets stay still · 120ms hover intent";
	app.dataset.sidebar = "open";
	$("#sidebar-toggle").setAttribute("aria-pressed", "true");
	$("#preview-width").value = "auto";
	for (const button of $$("[data-layout-choice]")) {
		button.setAttribute(
			"aria-pressed",
			String(button.dataset.layoutChoice === "proposed"),
		);
	}
	renderTabs();
	renderConversation();
	list.scrollLeft = 0;
	notify("Preview reset");
};
hydrateIcons();
renderTabs();
renderConversation();
new ResizeObserver(sizePreview).observe($("#stage"));

function hideHoverCard() {
	hoverId = null;
	$("#hover-card").hidden = true;
	for (const tab of $$(".session-tab")) tab.classList.remove("hover-target");
}
function showHoverCard(id) {
	hideHoverCard();
	if (!id || id === selected) return;
	const tab = tabs.find((tab) => tab.id === id);
	const target = list.querySelector(`[data-id="${id}"]`);
	if (!target || !tab) return;
	hoverId = id;
	target.classList.add("hover-target");
	const card = $("#hover-card");
	card.innerHTML = `<img src="assets/${tab.provider}.svg" alt=""><div><strong>${escapeHtml(tab.name)}</strong><small>${providers[tab.provider]} · ${tab.panes || 1} ${tab.panes > 1 ? "panes" : "pane"}${tab.status === "working" ? " · Working" : ""}</small></div>`;
	card.hidden = false;
	const bounds = target.getBoundingClientRect();
	const appBounds = app.getBoundingClientRect();
	const x = (bounds.left + bounds.width / 2 - appBounds.left) / scale;
	const left = Math.max(
		16,
		Math.min(app.offsetWidth - card.offsetWidth - 16, x - card.offsetWidth / 2),
	);
	card.style.left = `${left}px`;
	card.style.top = `${(bounds.bottom - appBounds.top) / scale + 12}px`;
	card.style.transformOrigin = `${x - left}px 0`;
	for (const animation of card.getAnimations()) animation.cancel();
	if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
		card.animate(
			[
				{ opacity: 0, transform: "translateY(-5px) scale(.96)" },
				{ opacity: 1, transform: "translateY(0) scale(1)" },
			],
			{ duration: 240, easing: "cubic-bezier(.16,1,.3,1)" },
		);
}
for (const button of $$("[data-hover-choice]"))
	button.onclick = () => {
		clearTimeout(hoverTimer);
		hideHoverCard();
		app.dataset.hover = button.dataset.hoverChoice;
		for (const other of $$("[data-hover-choice]"))
			other.setAttribute("aria-pressed", String(other === button));
		expanded = selected;
		renderTabs();
		$("#physics-status").textContent =
			app.dataset.hover === "stable"
				? "Targets stay still · 120ms hover intent"
				: "Old behavior · neighbors move during expansion";
	};
$("#hover-demo").onclick = () => {
	clearTimeout(demoTimer);
	hideHoverCard();
	let step = 0;
	const ids = tabs
		.filter((tab) => tab.id !== selected)
		.slice(0, 5)
		.map((tab) => tab.id);
	const tick = () => {
		const id = ids[step++];
		const pointer = $("#demo-pointer");
		if (!id) {
			pointer.hidden = true;
			hideHoverCard();
			setExpanded(selected);
			return;
		}
		ensureVisible(id);
		const rect = list
			.querySelector(`[data-id="${id}"]`)
			.getBoundingClientRect();
		const origin = app.getBoundingClientRect();
		pointer.hidden = false;
		pointer.style.left = `${(rect.left + rect.width / 2 - origin.left) / scale}px`;
		pointer.style.top = `${(rect.top + rect.height / 2 - origin.top) / scale}px`;
		setExpanded(id);
		demoTimer = setTimeout(tick, 1250);
	};
	notify("Simulated pointer demonstration. Your real cursor is unchanged.");
	tick();
};
$("#build-demo").onclick = () => {
	clearInterval(buildTimer);
	const button = $("#build-status");
	let value = 0;
	const draw = () => {
		button.title =
			value >= 100
				? "Demo installer ready"
				: `Demo installer: ${value}% of steps complete`;
		button.innerHTML =
			value >= 100
				? icon("Check")
				: `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity=".2"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" pathLength="100" stroke-dasharray="${value} 100" stroke-linecap="round" transform="rotate(-90 12 12)"/></svg>`;
		if (value >= 100) clearInterval(buildTimer);
	};
	draw();
	buildTimer = setInterval(() => {
		value += 10;
		draw();
	}, 900);
	notify("Simulated build progress: circle fills as steps finish.");
};
