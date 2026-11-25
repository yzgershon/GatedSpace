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
const shot = async (name) => {
	await page.waitForTimeout(280);
	await page.screenshot({
		path: `.tmp/mobile-duet-study/reference-${name}.png`,
	});
};
try {
	await mkdir(".tmp/mobile-duet-study", { recursive: true });
	await api("preview/reset", {});
	await page.goto(`${origin}/?t=preview-token#session=codex&provider=codex`);
	await page.locator(".typing-bubble").waitFor();
	assert.equal(await page.evaluate(() => currentProvider), "codex");
	assert.equal(new URL(page.url()).search, "");
	assert.equal(new URL(page.url()).hash, "");
	assert.equal(
		await page.locator(".who, .save-reply, details.activity").count(),
		0,
	);
	await page
		.getByRole("textbox", { name: "Message", exact: true })
		.fill("My unsent screenshot notes");
	for (const width of [320, 390, 430]) {
		await page.setViewportSize({ width, height: 844 });
		const rail = await page.locator("#tabs").boundingBox();
		const computer = await page.locator("#computer-menu").boundingBox();
		assert(
			computer.x >= rail.x + rail.width + 5,
			"Computer button is separate from the pill dock",
		);
		await page.getByRole("button", { name: "Profile and settings" }).click();
		await page
			.getByRole("heading", { name: "Settings", exact: true })
			.waitFor();
		assert(
			await page
				.locator(".settings-sheet")
				.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
		);
		await page.getByRole("button", { name: /Display and motion/ }).click();
		await page.getByRole("button", { name: "Reduced", exact: true }).click();
		await page.getByRole("button", { name: "Back to settings" }).click();
		await page.getByRole("button", { name: /^Network access/ }).click();
		assert(
			await page
				.locator(".settings-sheet")
				.getByText("Encrypted", { exact: true })
				.isVisible(),
		);
		await page.getByRole("button", { name: "Done", exact: true }).click();
		assert.equal(
			await page.locator("#input").inputValue(),
			"My unsent screenshot notes",
		);
		assert(await page.locator(".typing-bubble").isVisible());
	}
	console.log(
		"PASS separate dock and settings preserve the running conversation and draft at three phone widths",
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await shot("chat");
	await page.getByRole("button", { name: "Profile and settings" }).click();
	await shot("settings");
	await page.getByRole("button", { name: /^Themes/ }).click();
	assert((await page.locator(".theme-card").count()) > 3);
	const alternateTheme = page
		.locator('.theme-card[aria-pressed="false"]')
		.first();
	const alternateName = await alternateTheme.getAttribute("aria-label");
	await alternateTheme.click();
	assert.equal(
		await page
			.locator('.theme-card[aria-pressed="true"]')
			.getAttribute("aria-label"),
		alternateName,
	);
	await shot("themes");
	await page.reload();
	await page.getByRole("button", { name: "Profile and settings" }).click();
	await page.getByRole("button", { name: /^Themes/ }).click();
	assert.equal(
		await page
			.locator('.theme-card[aria-pressed="true"]')
			.getAttribute("aria-label"),
		alternateName,
	);
	await page.getByRole("button", { name: "Dracula", exact: true }).click();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: /GatedSpace mobile/ }).click();
	await page.locator(".typing-bubble").waitFor();
	console.log(
		"PASS replies omit labels, Save buttons and tool traces; visual themes survive reload",
	);
	await page
		.getByRole("button", { name: "Open conversations", exact: true })
		.click();
	await page.locator(".conversation-link").first().waitFor();
	await shot("menu");
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Computers", exact: true }).click();
	await page
		.getByRole("heading", { name: "Your desktop", exact: true })
		.waitFor();
	await page.getByRole("button", { name: "Refresh computers" }).click();
	await page
		.getByRole("heading", { name: "Your desktop", exact: true })
		.waitFor();
	await shot("computers");
	await page.getByRole("button", { name: "Close Computers" }).click();
	assert.equal(
		await page.locator("#input").inputValue(),
		"My unsent screenshot notes",
	);
	console.log(
		"PASS drawer, full-screen computers and refresh return to the original draft",
	);

	await page.getByRole("button", { name: "Tasks", exact: true }).click();
	await page
		.getByLabel("Add a task", { exact: true })
		.fill("Review the mobile screenshots");
	await page.getByLabel("Add a task", { exact: true }).press("Enter");
	await page
		.locator(".task-row")
		.filter({ hasText: "Review the mobile screenshots" })
		.waitFor();
	await page.getByLabel("Search tasks", { exact: true }).fill("nonexistent");
	assert.equal(await page.locator(".task-row").count(), 0);
	await page.getByLabel("Search tasks", { exact: true }).fill("mobile");
	await page.locator(".task-row").waitFor();
	await shot("tasks");
	assert.equal((await api("mobile/hub")).tasks.length, 1);
	console.log(
		"PASS quick task creation persists once and task search filters the saved list",
	);

	const saved = await api("mobile/hub/outputs", {
		id: crypto.randomUUID(),
		title: "Mobile layout notes",
		body: "# Mobile layout notes\n\nKeep conversations close.\n\n- Separate computer button\n- Settings without losing your draft\n- Saved work with a readable preview",
		channelId: null,
	});
	assert.equal(saved.title, "Mobile layout notes");
	await page.getByRole("button", { name: "Make", exact: true }).click();
	await page.locator(".output-card").waitFor();
	assert.match(
		await page.locator(".output-excerpt").textContent(),
		/Separate computer button/,
	);
	await shot("make");
	await page.getByRole("button", { name: /Study guide/ }).click();
	await page.getByLabel("Agent", { exact: true }).selectOption("codex");
	await page
		.getByRole("button", { name: "Create session", exact: true })
		.click();
	await page.waitForFunction(() =>
		input.value.startsWith("Help me create a study guide."),
	);
	assert.equal(
		(await api("preview/received")).filter((action) => action.action === "send")
			.length,
		0,
	);
	assert.deepEqual(errors, []);
	console.log(
		"PASS Make shows saved content and templates prepare an unsent draft, with no page errors",
	);
} finally {
	await browser.close();
}
