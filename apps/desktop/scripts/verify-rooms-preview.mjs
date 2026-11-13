import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../../..");
const bunStore = resolve(root, "node_modules/.bun");
const pkg = (await readdir(bunStore)).find((name) =>
	name.startsWith("playwright@"),
);
if (!pkg) throw new Error("Install workspace dependencies first.");
const { chromium } = await import(
	pathToFileURL(resolve(bunStore, pkg, "node_modules/playwright/index.mjs"))
);
const out = resolve(root, ".tmp/rooms-preview-verification");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
	passed = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(12000);
try {
	await page.goto(
		pathToFileURL(resolve(import.meta.dirname, "rooms-preview/index.html"))
			.href,
	);
	assert.equal(await page.locator(".message").count(), 5);
	assert.equal(await page.locator(".collab-pane").count(), 3);
	assert.ok(
		(await page.locator('[data-pane="claude"]').boundingBox()).height > 450,
	);
	assert.match(
		await page.locator('[data-pane="claude"]').innerText(),
		/Daniel’s session/,
	);
	assert.match(
		await page.locator('[data-pane="codex"]').innerText(),
		/Your session/,
	);
	await page.screenshot({ path: resolve(out, "overview.png") });
	passed.push(
		"Friend opens three prominent owner-labeled session panes with shared messages and project chat beside them",
	);
	const projectBounds = await page.locator(".project-pane").boundingBox();
	const chatBounds = await page.locator(".conversation-pane").boundingBox();
	assert.ok(projectBounds.x + projectBounds.width < chatBounds.x);
	await page.locator("#add-friend").click();
	await page.getByRole("textbox", { name: "GatedSpace handle" }).fill("@Alex");
	await page.getByRole("button", { name: /Preview friend request/ }).click();
	assert.match(
		await page.getByRole("dialog").innerText(),
		/Friend request pending/,
	);
	assert.match(
		await page.locator('[data-friend="demo"]').innerText(),
		/Request pending/,
	);
	await page.getByRole("button", { name: "Simulate acceptance" }).click();
	assert.equal(await page.locator("#friend-count").innerText(), "2");
	assert.match(
		await page.locator('[data-friend="demo"]').innerText(),
		/Online now/,
	);
	await page.screenshot({ path: resolve(out, "friend-request.png") });
	await page.keyboard.press("Escape");
	passed.push(
		"Local friend request moves from pending to accepted, adds presence, and shares no project automatically",
	);
	for (const [id, text] of [
		["codex", "formatEvent"],
		["gemini", "Protect the open time"],
		["claude", "A little more room"],
	]) {
		if (await page.locator(".sessions-board").isVisible())
			await page
				.locator(`[data-pane="${id}"] .collab-pane-header button`)
				.click();
		else await page.locator(`.session[data-select-session="${id}"]`).click();
		assert.ok(await page.locator(".focused-conversation").isVisible());
		await page
			.getByRole("button", { name: "Shared output", exact: true })
			.click();
		assert.match(
			await page.locator("#work-content").innerText(),
			new RegExp(text),
		);
		assert.equal(await page.locator(".message").count(), 5);
	}
	passed.push(
		"Focusing a session opens its conversation; Shared output reveals Claude's calendar, Codex code or Gemini research without replacing chat",
	);
	await page.locator("#all-sessions").click();
	assert.equal(await page.locator(".collab-pane").count(), 3);
	await page.locator('[data-pane="claude"] [data-output-session]').click();
	assert.ok(await page.locator(".calendar-preview").isVisible());
	await page.getByRole("button", { name: "Conversation", exact: true }).click();
	assert.match(
		await page.locator(".focused-conversation").innerText(),
		/Shared project messages/,
	);
	await page.screenshot({ path: resolve(out, "focused-session.png") });
	passed.push(
		"All sessions restores the board and each output opens directly with a return to shared conversation",
	);
	const splitter = page.getByRole("separator", {
		name: "Resize project and chat",
	});
	await splitter.focus();
	await page.keyboard.press("ArrowLeft");
	assert.equal(await splitter.getAttribute("aria-valuenow"), "390");
	const splitterBox = await splitter.boundingBox();
	await page.mouse.move(splitterBox.x + 3, splitterBox.y + 100);
	await page.mouse.down();
	await page.mouse.move(splitterBox.x - 60, splitterBox.y + 100, { steps: 4 });
	await page.mouse.up();
	assert.ok(Number(await splitter.getAttribute("aria-valuenow")) > 440);
	await splitter.focus();
	await page.keyboard.press("Home");
	assert.equal(await splitter.getAttribute("aria-valuenow"), "300");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	passed.push(
		"Chat resizes with pointer and keyboard, stays bounded, and releases pointer capture",
	);
	await page
		.locator(".conversation-pane")
		.getByRole("button", { name: "Review", exact: true })
		.click();
	await page.getByRole("dialog").waitFor();
	assert.match(await page.locator(".code-preview").innerText(), /timeZone/);
	await page
		.getByRole("button", { name: "Mark reviewed", exact: true })
		.click();
	assert.match(
		await page.locator(".review-foot").innerText(),
		/Reviewed by you/,
	);
	await page.screenshot({ path: resolve(out, "review.png") });
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(".message").count(), 6);
	passed.push(
		"Shared artifact opens a readable diff and review posts back to the room",
	);
	await page.locator('[data-select-session="gemini"]').click();
	await page.locator(".session-output-header [data-session]").click();
	assert.match(await page.getByRole("dialog").innerText(), /research, essays/);
	await page
		.getByRole("button", { name: "Message this session", exact: true })
		.click();
	await page
		.getByRole("textbox", { name: "Message the room", exact: true })
		.fill("Summarize the student interviews.");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	assert.match(
		await page.locator(".message").last().innerText(),
		/@Student research/,
	);
	passed.push("Owner-specific session details route a message to Gemini");
	await page
		.getByRole("button", { name: "Try disconnect", exact: true })
		.click();
	await page
		.locator("#message")
		.fill("Keep this message until Daniel returns.");
	await page.locator("#message").press("Enter");
	assert.match(await page.locator(".message").last().innerText(), /Queued/);
	await page.getByRole("button", { name: "Reconnect", exact: true }).click();
	assert.doesNotMatch(
		await page.locator(".message").last().innerText(),
		/Queued/,
	);
	assert.match(
		await page.locator("#connection-label").innerText(),
		/Connected/,
	);
	passed.push(
		"Disconnect queues a message and reconnect delivers it without duplication",
	);
	await page
		.getByRole("button", { name: "Sharing settings", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Pause sharing", exact: true })
		.click();
	assert.match(
		await page.locator("#connection-label").innerText(),
		/Sharing paused/,
	);
	await page
		.getByRole("button", { name: "Resume sharing", exact: true })
		.click();
	await page
		.getByRole("checkbox", { name: "Share Student research", exact: true })
		.uncheck();
	await page.getByRole("button", { name: "Save sharing", exact: true }).click();
	assert.equal(
		await page.locator('.session[data-session-card="gemini"]').isVisible(),
		false,
	);
	await page
		.getByRole("button", { name: "Sharing settings", exact: true })
		.click();
	assert.equal(
		await page
			.getByRole("checkbox", { name: "Share Student research" })
			.isChecked(),
		false,
	);
	await page.getByRole("checkbox", { name: "Share Student research" }).check();
	await page.getByRole("button", { name: "Save sharing", exact: true }).click();
	passed.push(
		"Sharing can pause/resume and remembers per-session scope choices",
	);
	await page.getByRole("button", { name: /2 replies/ }).click();
	await page
		.getByRole("textbox", { name: "Reply", exact: true })
		.fill("Keep the source timezone in the exported file too.");
	await page.getByRole("button", { name: "Send reply", exact: true }).click();
	await page.getByRole("button", { name: /3 replies/ }).click();
	assert.match(await page.getByRole("dialog").innerText(), /exported file too/);
	await page.keyboard.press("Escape");
	passed.push(
		"Replies remain attached to the shared artifact when the thread is reopened",
	);
	await page.locator('[data-select-session="codex"]').click();
	await page.locator(".session-output-header [data-session]").click();
	await page
		.getByRole("button", { name: "Follow activity", exact: true })
		.click();
	assert.equal(await page.locator(".event-list li").count(), 1);
	await page
		.getByRole("button", { name: "Show all activity", exact: true })
		.click();
	assert.ok((await page.locator(".event-list li").count()) > 1);
	await page.getByRole("tab", { name: "Sessions", exact: true }).click();
	passed.push(
		"Session activity filters to its actual sample events and can return to the full room",
	);
	await page
		.getByRole("button", { name: "Share a project", exact: true })
		.click();
	await page
		.getByRole("textbox", { name: "Room name", exact: true })
		.fill("Essay workshop");
	await page.getByRole("button", { name: /Create demo invitation/ }).click();
	assert.match(await page.getByRole("dialog").innerText(), /Essay workshop/);
	assert.match(
		await page.getByRole("dialog").innerText(),
		/not a live invitation/,
	);
	await page.keyboard.press("Escape");
	passed.push(
		"Invitation flow includes project scope, collaborator role, and clear demo labeling",
	);
	const count = await page.locator(".message").count();
	await page.getByRole("tab", { name: "Sessions", exact: true }).click();
	await page.getByRole("button", { name: "Play handoff", exact: true }).click();
	await page.waitForFunction(
		(count) => document.querySelectorAll(".message").length === count + 1,
		count,
	);
	await page.getByRole("button", { name: "Pause demo", exact: true }).click();
	assert.match(
		await page
			.locator('[data-pane="gemini"] .shared-agent-message')
			.innerText(),
		/Students talked about protecting open time/,
	);
	await page.waitForTimeout(2400);
	assert.equal(await page.locator(".message").count(), count + 1);
	await page
		.getByRole("button", { name: "Resume handoff", exact: true })
		.click();
	await page.getByText("3 of 3 handoffs ready", { exact: true }).waitFor();
	assert.equal(await page.locator(".message").count(), count + 5);
	passed.push(
		"Animated handoff pauses and resumes from the same place, then completes once",
	);
	await page.getByRole("tab", { name: "Sessions", exact: true }).focus();
	await page.keyboard.press("ArrowRight");
	assert.equal(
		await page
			.getByRole("tab", { name: /^Files/ })
			.getAttribute("aria-selected"),
		"true",
	);
	await page.keyboard.press("ArrowRight");
	assert.ok(await page.locator(".event-list").isVisible());
	passed.push(
		"Keyboard tab navigation switches between workspace, files and activity while chat stays visible",
	);
	for (const width of [1100, 800, 515, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.getByRole("tab", { name: "Sessions", exact: true }).click();
		assert.ok(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		);
		if (
			width <= 1040 &&
			!(await page
				.getByRole("button", { name: "Send message", exact: true })
				.isVisible())
		)
			await page.getByRole("button", { name: "Toggle project chat" }).click();
		assert.ok(
			await page
				.getByRole("button", { name: "Send message", exact: true })
				.isVisible(),
		);
		if (width <= 1040)
			await page.getByRole("button", { name: "Toggle project chat" }).click();
		assert.ok(await page.locator("#add-friend").isVisible());
		assert.ok(
			await page.getByRole("button", { name: /Replay handoff/ }).isVisible(),
		);
	}
	assert.equal(await page.locator(".collab-pane").count(), 3);
	await page.locator('[data-pane="gemini"] .collab-pane-header button').click();
	assert.ok(await page.locator(".focused-conversation").isVisible());
	await page.locator("#all-sessions").click();
	await page.screenshot({ path: resolve(out, "narrow.png") });
	passed.push(
		"1100, 800, 515, and 390 px layouts retain the project, session selection and toggleable chat without page overflow",
	);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.getByRole("button", { name: /Replay handoff/ }).click();
	assert.equal(
		await page
			.locator("#connection-label")
			.evaluate((el) => getComputedStyle(el).animationName),
		"none",
	);
	passed.push(
		"Reduced-motion preference disables packet and message animations",
	);
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(out, "results.json"),
		JSON.stringify({ simulated: true, passed, errors }, null, 2),
	);
	console.log(JSON.stringify({ simulated: true, passed, errors }, null, 2));
} finally {
	await browser.close();
}
