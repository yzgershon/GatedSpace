import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE || "playwright"
);
const origin = process.env.MOBILE_PREVIEW_ORIGIN || "http://127.0.0.1:52136";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
});
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const api = (path, body) =>
	fetch(`${origin}/api/${path}`, {
		headers: {
			"x-bridge-token": "preview-token",
			"content-type": "application/json",
		},
		...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
	}).then((r) => r.json());
const poll = () =>
	page.evaluate(async () => {
		while (refreshBusy) await new Promise((r) => setTimeout(r, 10));
		refresh();
		while (refreshBusy) await new Promise((r) => setTimeout(r, 10));
	});
const menu = () =>
	page.getByRole("button", { name: "Open conversations", exact: true }).click();
try {
	await api("preview/reset", {});
	await page.goto(`${origin}/?t=preview-token`);
	await page.getByRole("button", { name: /GatedSpace mobile/ }).click();
	await page.locator(".typing-bubble").waitFor();
	assert(
		await page.getByRole("button", { name: "Send", exact: true }).isVisible(),
	);
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("Keep this unsent draft");
	await menu();
	const order = await page
		.locator(".conversation-link strong")
		.allTextContents();
	assert.deepEqual(order.slice(0, 2), ["GatedSpace mobile", "Yuta"]);
	await page.getByRole("button", { name: /Yuta Claude/ }).click();
	await page.locator('.typing-bubble[data-provider="claude"]').waitFor();
	assert.equal(
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.inputValue(),
		"",
	);
	await menu();
	await page.getByRole("button", { name: /GatedSpace mobile Codex/ }).click();
	assert.equal(
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.inputValue(),
		"Keep this unsent draft",
	);
	console.log(
		"PASS recent-session menu switches directly and preserves independent drafts",
	);

	await page.locator("#file").setInputFiles({
		name: "screen.png",
		mimeType: "image/png",
		buffer: Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8P8AAAAASUVORK5CYII=",
			"base64",
		),
	});
	await page.locator("#shelf img").waitFor();
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page.waitForFunction(() => input.value === "");
	const delivered = await api("preview/received");
	assert.equal(delivered.filter((x) => x.action === "send").length, 1);
	assert.equal(delivered.at(-1).body.images.length, 1);
	assert.equal(delivered.at(-1).body.text, "Keep this unsent draft");
	assert(await page.locator(".typing-bubble").isVisible());
	await page
		.getByRole("button", { name: "Stop response", exact: true })
		.click();
	await page.locator(".typing-bubble").waitFor({ state: "hidden" });
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("Continue after stop");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page.waitForFunction(() => input.value === "");
	console.log(
		"PASS image steering remains sendable while working and after Stop",
	);

	await api("preview/state", { provider: "codex", state: { working: true } });
	await poll();
	const purple = await page
		.locator(".turn.assistant")
		.first()
		.evaluate((e) => getComputedStyle(e).backgroundColor);
	await mkdir(".tmp/mobile-duet-study", { recursive: true });
	for (const width of [320, 390, 430, 1280]) {
		await page.setViewportSize({ width, height: 844 });
		assert(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
		);
		const brand = await page.locator(".mobile-brand").boundingBox();
		assert(Math.abs(brand.x + brand.width / 2 - width / 2) < 2);
		const dock = await page.locator("#tabs").boundingBox(),
			composer = await page.locator("#composer").boundingBox();
		assert(composer.y + composer.height <= dock.y + 1);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: ".tmp/mobile-duet-study/gatedduet-codex-conversation.png",
	});
	await menu();
	await page.getByRole("button", { name: /Yuta Claude/ }).click();
	await page
		.locator('.turn.assistant[data-provider="claude"]')
		.first()
		.waitFor();
	const orange = await page
		.locator(".turn.assistant")
		.first()
		.evaluate((e) => getComputedStyle(e).backgroundColor);
	assert.notEqual(purple, orange);
	await page.screenshot({
		path: ".tmp/mobile-duet-study/gatedduet-claude-conversation.png",
	});
	console.log(
		"PASS centered header and dock, contained layouts, distinct provider bubbles",
	);

	await page.getByRole("button", { name: "Computers", exact: true }).click();
	await page
		.getByRole("heading", { name: "Your desktop", exact: true })
		.waitFor();
	assert(await page.getByRole("button", { name: "+ New session" }).isVisible());
	await page.getByRole("button", { name: "Close Computers" }).click();
	await page.getByRole("button", { name: "Profile and settings" }).click();
	await page.getByRole("button", { name: /Display and motion/ }).click();
	await page.getByRole("button", { name: "Reduced", exact: true }).click();
	await page.getByRole("button", { name: "Large", exact: true }).click();
	await page.reload();
	assert.equal(
		await page.locator("body").getAttribute("data-motion"),
		"reduced",
	);
	await page.getByRole("button", { name: /GatedSpace mobile/ }).click();
	await page.locator(".typing-bubble").waitFor();
	assert.equal(
		await page
			.locator(".typing-bubble i")
			.first()
			.evaluate((e) => getComputedStyle(e).animationName),
		"none",
	);
	assert.equal(
		await page
			.locator(".message-text")
			.first()
			.evaluate((e) => getComputedStyle(e).fontSize),
		"17px",
	);
	console.log("PASS computer panel and persisted accessibility preferences");
	assert.deepEqual(errors, []);
} finally {
	await browser.close();
}
