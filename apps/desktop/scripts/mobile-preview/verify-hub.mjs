import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

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
const errors = [],
	checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (text) => {
	checks.push(text);
	console.log("PASS", text);
};
const api = async (path, method = "GET", body) =>
	fetch(`${origin}/api/${path}`, {
		method,
		headers: {
			"x-bridge-token": "preview-token",
			"content-type": "application/json",
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	}).then((r) => r.json());
try {
	await mkdir(".tmp/mobile-duet-study", { recursive: true });
	await api("preview/reset", "POST", {});
	await page.goto(`${origin}/?t=preview-token`);
	await page.getByRole("button", { name: /GatedSpace mobile/ }).waitFor();
	assert.equal(
		await page
			.locator(".mobile-brand img")
			.evaluate((img) => img.complete && img.naturalWidth > 0),
		true,
	);
	await page.screenshot({
		path: ".tmp/mobile-duet-study/gatedspace-chats.png",
	});
	await page
		.getByRole("button", { name: "Open conversations", exact: true })
		.click();
	await page
		.getByRole("button", { name: "+ New channel", exact: true })
		.click();
	await page.getByLabel("Name", { exact: true }).fill("Project Atlas");
	await page
		.getByRole("button", { name: "Create channel", exact: true })
		.click();
	await page
		.getByRole("heading", { name: "Project Atlas", exact: true })
		.waitFor();
	check("create channel and return to filtered conversations");

	await page.getByRole("button", { name: "Tasks", exact: true }).click();
	await page.getByRole("button", { name: "+ New task", exact: true }).click();
	await page
		.getByLabel("What needs doing?", { exact: true })
		.fill("Review the launch plan");
	await page
		.getByLabel("Details", { exact: true })
		.fill("Check the project and draft the next steps.");
	await page.getByRole("button", { name: "Save task", exact: true }).click();
	await page
		.locator(".task-row")
		.filter({ hasText: "Review the launch plan" })
		.click();
	await page
		.getByRole("button", { name: "Mark complete", exact: true })
		.click();
	await page.getByLabel("Task status", { exact: true }).selectOption("done");
	await page
		.locator(".task-row")
		.filter({ hasText: "Review the launch plan" })
		.waitFor();
	await page.screenshot({
		path: ".tmp/mobile-duet-study/gatedspace-tasks.png",
	});
	await page.reload();
	await page.getByRole("button", { name: "Tasks", exact: true }).click();
	await page.getByLabel("Task status", { exact: true }).selectOption("done");
	await page
		.locator(".task-row")
		.filter({ hasText: "Review the launch plan" })
		.click();
	await page.getByRole("button", { name: "Reopen task", exact: true }).click();
	await page.getByRole("button", { name: "All", exact: true }).click();
	await page.locator(".task-row").click();
	await page
		.getByRole("button", { name: "Start a conversation", exact: true })
		.click();
	await page.getByLabel("Agent", { exact: true }).selectOption("codex");
	await page
		.getByRole("button", { name: "Create session", exact: true })
		.click();
	await page.waitForFunction(() => current === "codex" && !sessionData.loading);
	assert.match(
		await page.locator("#input").inputValue(),
		/Review the launch plan/,
	);
	assert.equal((await api("preview/received")).length, 0);
	check(
		"task completion persists and linked conversation prepares a draft without sending",
	);
	await page
		.getByRole("button", { name: "Open conversations", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Save a reply to Make", exact: true })
		.click();
	await page.locator(".reply-choice").first().click();
	await page.getByLabel("Title", { exact: true }).fill("Atlas project brief");
	await page.getByRole("button", { name: "Save reply", exact: true }).click();
	await page.getByText("Saved to Make.", { exact: true }).waitFor();
	await page.getByRole("button", { name: "Make", exact: true }).click();
	await page
		.locator(".output-card")
		.filter({ hasText: "Atlas project brief" })
		.waitFor();
	await page.screenshot({ path: ".tmp/mobile-duet-study/gatedspace-make.png" });
	await page.locator(".output-card").click();
	await page.locator(".saved-output").waitFor();
	const downloadEvent = page.waitForEvent("download");
	await page
		.getByRole("button", { name: "Download Markdown", exact: true })
		.click();
	const download = await downloadEvent;
	assert.equal(download.suggestedFilename(), "Atlas project brief.md");
	await page.getByRole("button", { name: "Archive", exact: true }).click();
	await page.getByRole("button", { name: "Archived", exact: true }).click();
	await page.locator(".output-card").waitFor();
	check("save real reply, render its Markdown, download, and archive");
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	await page.waitForFunction(() => current === "codex" && !sessionData.loading);
	assert.match(
		await page.locator("#input").inputValue(),
		/Review the launch plan/,
	);
	check("dock returns to the same provider and preserves the draft");
	for (const width of [320, 390, 430, 1280]) {
		await page.setViewportSize({ width, height: 844 });
		await page.screenshot({
			path: `.tmp/mobile-duet-study/gatedspace-chat-${width}.png`,
		});
		const dimensions = await page.evaluate(() => ({
			width: document.documentElement.clientWidth,
			scroll: document.documentElement.scrollWidth,
			composer: document
				.getElementById("composer")
				.getBoundingClientRect()
				.toJSON(),
			dock: document.getElementById("tabs").getBoundingClientRect().toJSON(),
		}));
		assert.ok(
			dimensions.scroll <= dimensions.width + 1,
			`page overflow at ${width}`,
		);
		assert.ok(
			dimensions.composer.bottom <= dimensions.dock.top,
			`composer overlaps dock at ${width}`,
		);
	}
	check(
		"320/390/430/1280px layouts contain content and separate composer from dock",
	);
	await page
		.getByRole("button", { name: "Profile and settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Usage ›", exact: true }).click();
	await page.getByRole("heading", { name: "Usage", exact: true }).waitFor();
	await page
		.getByRole("button", { name: "Profile and settings", exact: true })
		.click();
	await page
		.getByRole("heading", { name: "Settings", level: 2, exact: true })
		.waitFor();
	check("usage and settings remain reachable through profile controls");
	assert.deepEqual(errors, []);
	await writeFile(
		".tmp/mobile-duet-study/hub-checks.json",
		JSON.stringify(
			{
				checks,
				errors,
				evidence:
					"Real source with simulated providers; not a phone or cloud-run test",
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
