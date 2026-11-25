import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE || "playwright"
);
const origin = process.env.MOBILE_PREVIEW_ORIGIN || "http://127.0.0.1:52132";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
	checks = [];
const context = await browser.newContext({
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const post = (path, body) =>
	fetch(`${origin}/api/preview/${path}`, {
		method: "POST",
		headers: {
			"x-bridge-token": "preview-token",
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
const state = async (provider, data) => {
	await post("state", { provider, state: data });
};
const check = (name) => {
	checks.push(name);
	console.log(`PASS ${name}`);
};
const poll = () =>
	page.evaluate(async () => {
		while (refreshBusy) await new Promise((r) => setTimeout(r, 10));
		refresh();
		while (refreshBusy) await new Promise((r) => setTimeout(r, 10));
	});
const open = async (provider) => {
	await page.goto(`${origin}/?t=preview-token`);
	await page
		.getByRole("button", {
			name: provider === "codex" ? /GatedSpace mobile/ : /Filtrsoft/,
		})
		.click();
	await page.waitForFunction(() => sessionData && !sessionData.loading);
};
const pixel =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8P8AAAAASUVORK5CYII=";
try {
	await mkdir(".tmp/mobile-regressions", { recursive: true });
	await post("reset", {});
	// HTTP LAN links lack randomUUID. Keep the browser's real getRandomValues.
	await page.addInitScript(() =>
		Object.defineProperty(crypto, "randomUUID", { value: undefined }),
	);
	let releaseThemes;
	const waitThemes = new Promise((resolve) => {
		releaseThemes = resolve;
	});
	await page.route("**/api/themes", async (route) => {
		await waitThemes;
		await route.continue();
	});
	await page.goto(`${origin}/?t=preview-token`);
	await page
		.getByRole("button", { name: /GatedSpace mobile/ })
		.waitFor({ timeout: 1500 });
	const themeResponse = page.waitForResponse((r) =>
		r.url().endsWith("/api/themes"),
	);
	releaseThemes();
	await themeResponse;
	await page.unroute("**/api/themes");
	await page.waitForFunction(
		() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--bg")
				.trim() === "#282a36",
	);
	check("slow theme request never blocks opening the session list");
	for (const provider of ["codex", "claude"]) {
		await open(provider);
		await page.locator("#file").setInputFiles({
			name: "phone.png",
			mimeType: "image/png",
			buffer: Buffer.from(pixel, "base64"),
		});
		await page.waitForFunction(() => !attachmentJob && pending.length === 1);
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await page.waitForFunction(() => !pending.length);
		const received = await fetch(`${origin}/api/preview/received`, {
			headers: { "x-bridge-token": "preview-token" },
		}).then((r) => r.json());
		assert.match(
			received.at(-1).body.requestId,
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		await page.locator(".message-images img").last().waitFor();
		check(
			provider +
				": image-only send and transcript thumbnail work without randomUUID",
		);
	}
	await state("claude", {
		working: false,
		questions: [],
		messages: [
			{
				id: "markdown",
				kind: "assistant",
				text: "## Finished\n\n**All done.** Visit [the result](https://example.com).\n\n- One\n- Two\n\n```js\nconst safe = true;\n```\n\n<img src=x onerror=alert(1)>",
			},
		],
	});
	await open("claude");
	assert.equal(await page.locator(".markdown h2").textContent(), "Finished");
	assert.equal(
		await page.locator(".markdown strong").textContent(),
		"All done.",
	);
	assert.equal(await page.locator(".markdown img").count(), 0);
	assert.equal(
		await page.locator(".markdown a").getAttribute("href"),
		"https://example.com",
	);
	check("responses render readable Markdown and keep transcript HTML inert");
	await state("claude", { working: true });
	await poll();
	await page
		.getByRole("status")
		.filter({ hasText: /^Working$/ })
		.waitFor();
	await state("claude", { working: false });
	await poll();
	assert.equal(await page.locator(".thinking-word").count(), 0);
	assert.equal(await page.locator(".session-ready").textContent(), "Ready");
	assert(await page.locator("#stop").isHidden());
	check("working indicator and Stop settle when the agent completes");
	for (const provider of ["claude", "codex"]) {
		await state(provider, {
			working: true,
			questions: [
				{
					id: "multi",
					title: "Preferences",
					questions: [
						{
							id: "layout",
							question: "Choose layouts",
							multiSelect: true,
							options: ["Compact", "Wide"],
						},
					],
				},
			],
		});
		await open(provider);
		await page.getByRole("button", { name: "Compact", exact: true }).click();
		await page.getByRole("button", { name: "Wide", exact: true }).click();
		assert.equal(
			await page.locator(".answer-choice[aria-pressed=true]").count(),
			2,
		);
		await page.locator(".question-card summary").click();
		await page
			.getByRole("textbox", { name: /Other:/ })
			.fill("Keep draft while polling");
		await state(provider, {
			context: { contextTokens: 100, contextWindow: 1000 },
		});
		await poll();
		assert.equal(
			await page.getByRole("textbox", { name: /Other:/ }).inputValue(),
			"Keep draft while polling",
		);
		assert(
			await page
				.getByRole("textbox", { name: /Other:/ })
				.evaluate((el) => el === document.activeElement),
		);
		await page.getByRole("button", { name: "Dismiss question" }).click();
		await page.locator(".question-card").waitFor({ state: "hidden" });
		const received = await fetch(`${origin}/api/preview/received`, {
			headers: { "x-bridge-token": "preview-token" },
		}).then((r) => r.json());
		assert.equal(received.at(-1).body.allow, false);
		check(
			provider +
				": questions retain choices/text during polling and can be dismissed",
		);
	}
	await state("codex", {
		working: false,
		questions: [],
		messages: [
			{
				id: "tool",
				kind: "activity",
				title: "Read project",
				text: "const internal = 'tool output';",
			},
		],
	});
	await open("codex");
	assert.equal(await page.locator("details.activity[open]").count(), 0);
	await page.locator("details.activity summary").click();
	await page
		.getByText("const internal = 'tool output';", { exact: true })
		.waitFor();
	check("tool output loads only when its collapsed activity is opened");
	await page
		.locator("#input")
		.fill("A multiline draft\nSecond line\nThird line\nFourth line");
	await page.locator("#file").setInputFiles(
		Array.from({ length: 20 }, (_, i) => ({
			name: `photo-${i}.png`,
			mimeType: "image/png",
			buffer: Buffer.from(pixel, "base64"),
		})),
	);
	await page.waitForFunction(() => !attachmentJob && pending.length === 20);
	for (const width of [390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		await page.waitForTimeout(80);
		const layout = await page.evaluate(() => ({
			shelf: shelf.getBoundingClientRect().toJSON(),
			composer: composer.getBoundingClientRect().toJSON(),
			width: document.documentElement.scrollWidth,
			screen: window.innerWidth,
		}));
		assert(layout.shelf.bottom <= layout.composer.top + 1);
		assert(layout.width <= layout.screen + 1);
		await page.locator("#shelf").evaluate((el) => {
			el.scrollLeft = el.scrollWidth;
		});
		assert(
			await page
				.getByRole("button", { name: "Preview photo-19.png", exact: true })
				.isVisible(),
		);
	}
	check("20-photo shelf stays above a multiline composer and scrolls at 320px");
	await page.evaluate(() => {
		Object.defineProperty(visualViewport, "height", {
			value: window.innerHeight - 300,
			configurable: true,
		});
		Object.defineProperty(visualViewport, "offsetTop", {
			value: 0,
			configurable: true,
		});
		fitKeyboard();
		showHint("Photo ready", false);
	});
	const keyboard = await page.evaluate(() => ({
		composerBottom: composer.getBoundingClientRect().bottom,
		shelfTop: shelf.getBoundingClientRect().top,
		hintBottom: hint.getBoundingClientRect().bottom,
		visibleBottom: window.innerHeight - 300,
	}));
	assert(keyboard.composerBottom <= keyboard.visibleBottom + 1);
	assert(keyboard.hintBottom <= keyboard.shelfTop + 1);
	await page.evaluate(() => {
		delete visualViewport.height;
		delete visualViewport.offsetTop;
		fitKeyboard();
		hint.hidden = true;
	});
	check(
		"composer, photo shelf and errors remain above a simulated phone keyboard",
	);
	await page.screenshot({ path: ".tmp/mobile-regressions/attachments.png" });
	await state("claude", {
		working: false,
		questions: [],
		messages: Array.from({ length: 1000 }, (_, i) => ({
			id: `history-${i}`,
			kind: i % 2 ? "assistant" : "user",
			text: `Message ${i}`,
		})),
		hasEarlier: false,
	});
	await open("claude");
	assert.equal(await page.locator("[data-message]").count(), 60);
	await page.getByRole("button", { name: "Load earlier messages" }).click();
	await page.waitForFunction(
		() => document.querySelectorAll("[data-message]").length === 120,
	);
	await page.evaluate(() => {
		window.mutations = 0;
		window.observer = new MutationObserver(
			(records) => (window.mutations += records.length),
		);
		window.observer.observe(main, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	});
	await poll();
	assert.equal(await page.evaluate(() => window.mutations), 0);
	check(
		"1000-message history is paginated; unchanged polls do not rebuild the DOM",
	);
	await page.locator("#input").fill("Preserve failed draft");
	await page.route("**/claude/claude/send", (route) =>
		route.fulfill({
			status: 409,
			contentType: "application/json",
			body: JSON.stringify({ error: "Agent needs input" }),
		}),
	);
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await page
		.locator("#hint")
		.filter({ hasText: /Agent needs input/ })
		.waitFor();
	await poll();
	assert(await page.locator("#hint").isVisible());
	assert.equal(
		await page.locator("#input").inputValue(),
		"Preserve failed draft",
	);
	check(
		"failed uploads keep their draft and visible error after background polling",
	);
	assert.deepEqual(errors, []);
	check("no uncaught browser errors");
	await writeFile(
		".tmp/mobile-regressions/results.json",
		JSON.stringify(
			{
				ok: true,
				checks,
				errors,
				scope:
					"Production mobile UI and formatter, simulated session APIs; no physical phone or provider inference.",
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
