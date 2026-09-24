const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE || "playwright"
);

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 1,
	isMobile: true,
	hasTouch: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const check = (name) => {
	checks.push(name);
	console.log(`PASS ${name}`);
};
try {
	const origin = process.env.MOBILE_PREVIEW_ORIGIN || "http://127.0.0.1:52132";
	await fetch(`${origin}/api/preview/reset`, {
		method: "POST",
		headers: { "x-bridge-token": "preview-token" },
	});
	await page.goto(`${origin}/?t=preview-token`);
	await page.getByRole("button", { name: /GatedSpace mobile/ }).waitFor();
	assert(!page.url().includes("t="));
	check("pairing token removed from address");
	await page.getByRole("button", { name: "Codex", exact: true }).click();
	await page
		.getByRole("button", { name: /Filtrsoft/ })
		.waitFor({ state: "hidden" });
	await page.getByRole("button", { name: "All agents", exact: true }).click();
	await page.getByRole("searchbox").fill("Filtrsoft");
	await page
		.getByRole("button", { name: /GatedSpace mobile/ })
		.waitFor({ state: "hidden" });
	await page.getByRole("searchbox").fill("");
	check("provider filters and session search");
	await page.screenshot({ path: ".tmp/mobile-list.png" });
	await page.getByRole("button", { name: /GatedSpace mobile/ }).click();
	await page
		.getByText("Your conversation will stay visible", { exact: false })
		.waitFor();
	assert.equal(await page.locator("details.activity[open]").count(), 0);
	await page.getByText("Read mobile session routes", { exact: true }).click();
	await page.evaluate(() => refresh());
	await page.waitForTimeout(300);
	assert.equal(await page.locator("details.activity[open]").count(), 1);
	check("collapsed tools preserve expanded state across unchanged polls");
	await page.getByRole("button", { name: "View Layout reference" }).click();
	await page.getByRole("dialog").waitFor();
	await page.getByRole("button", { name: "Close image" }).click();
	check("clickable transcript image preview");
	await page.screenshot({ path: ".tmp/mobile-codex.png" });
	await page.locator(".question-card summary").click();
	await page.getByRole("textbox", { name: /Other:/ }).fill("Use my own layout");
	await page.evaluate(() => refresh());
	await page.waitForTimeout(200);
	assert.equal(
		await page.getByRole("textbox", { name: /Other:/ }).inputValue(),
		"Use my own layout",
	);
	await page.getByRole("button", { name: "Send response" }).click();
	await page.locator(".question-card").waitFor({ state: "hidden" });
	check("Other submits and survives polling");
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("Codex draft");
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page.getByRole("button", { name: /Filtrsoft/ }).click();
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("Claude draft");
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page.getByRole("button", { name: /GatedSpace mobile/ }).click();
	assert.equal(
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.inputValue(),
		"Codex draft",
	);
	check("per-agent drafts restore after navigation");
	await page
		.getByRole("button", { name: "Load earlier messages", exact: true })
		.click();
	await page
		.getByText("Earlier conversation message 0", { exact: true })
		.waitFor();
	assert.equal(
		await page
			.getByRole("button", { name: "Load earlier messages", exact: true })
			.count(),
		0,
	);
	check("earlier messages prepend and stop at beginning");
	await page.route("**/api/mobile/codex/codex", (route) =>
		route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({ error: "Desktop reconnecting" }),
		}),
	);
	await page.evaluate(() => refresh());
	await page.getByRole("status").filter({ hasText: "Reconnecting" }).waitFor();
	assert(
		await page
			.getByText("Earlier conversation message 0", { exact: true })
			.count(),
	);
	assert.equal(
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.inputValue(),
		"Codex draft",
	);
	check("network failure preserves transcript and draft");
	await page.unroute("**/api/mobile/codex/codex");
	await page.evaluate(() => refresh());
	await page
		.getByRole("button", { name: "Stop response", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Stop response", exact: true })
		.waitFor({ state: "hidden" });
	check("stop ends the working state");
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("A phone prompt");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page.getByText("A phone prompt", { exact: true }).waitFor();
	assert.equal(
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.inputValue(),
		"",
	);
	check("send is visible and clears accepted draft");
	// Keep a new draft even if the earlier send response arrives late.
	let releaseSend;
	const waiting = new Promise((resolve) => {
		releaseSend = resolve;
	});
	await page.route("**/api/mobile/codex/codex/send", async (route) => {
		await waiting;
		await route.continue();
	});
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("Delayed prompt");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("New text while waiting");
	releaseSend();
	await page.getByText("Delayed prompt", { exact: true }).waitFor();
	assert.equal(
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.inputValue(),
		"New text while waiting",
	);
	await page.unroute("**/api/mobile/codex/codex/send");
	check("delayed send preserves newer draft");
	// Navigating between agents while sending must never clear the other draft.
	let releaseNavigation;
	const pendingNavigation = new Promise((resolve) => {
		releaseNavigation = resolve;
	});
	await page.route("**/api/mobile/codex/codex/send", async (route) => {
		await pendingNavigation;
		await route.continue();
	});
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("Codex navigation prompt");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page.getByRole("button", { name: /Filtrsoft/ }).click();
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("Keep Claude draft");
	releaseNavigation();
	await page.waitForTimeout(500);
	assert.equal(
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.inputValue(),
		"Keep Claude draft",
	);
	await page.unroute("**/api/mobile/codex/codex/send");
	await page.reload();
	await page.getByRole("button", { name: /Filtrsoft/ }).click();
	assert.equal(
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.inputValue(),
		"Keep Claude draft",
	);
	check("send navigation isolates agents and drafts survive page reload");
	const pixel = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8P8AAAAASUVORK5CYII=",
		"base64",
	);
	await page.locator("#file").setInputFiles({
		name: "phone-image.png",
		mimeType: "image/png",
		buffer: pixel,
	});
	await page.getByRole("button", { name: "Preview phone-image.png" }).click();
	await page.getByRole("dialog").waitFor();
	await page.getByRole("button", { name: "Close image" }).click();
	await page.getByRole("textbox", { name: "Message", exact: true }).fill("");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page
		.getByRole("button", { name: "Preview phone-image.png" })
		.waitFor({ state: "hidden" });
	check("image-only sending and composer image preview");
	await page.screenshot({ path: ".tmp/mobile-conversation.png" });
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
		false,
	);
	check("390px layout has no horizontal overflow");
	await page.setViewportSize({ width: 320, height: 568 });
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
		false,
	);
	check("320px layout has no horizontal overflow");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(
		await page
			.locator("header")
			.evaluate((el) => getComputedStyle(el).animationName),
		"none",
	);
	check("reduced motion");
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page.getByRole("button", { name: "Usage", exact: true }).click();
	await page.getByText("weekly window", { exact: true }).waitFor();
	await page.getByText(/24%.*resets Friday/).waitFor();
	await page.getByText("12%", { exact: true }).waitFor();
	check(
		"Codex and Claude usage share the phone tab with accurate window labels",
	);
	assert.deepEqual(errors, []);
	check("no browser JavaScript errors");
	await writeFile(
		".tmp/mobile-ui-receipt.json",
		JSON.stringify({ checks, errors }, null, 2),
	);
} finally {
	await browser.close();
}
