import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const output = resolve(".tmp/sidebar-preview/checks");
await mkdir(output, { recursive: true });
const errors = [];
const checks = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
	await page.goto("http://127.0.0.1:52135");
	for (const design of ["Focus", "Collections", "Activity"]) {
		await page
			.getByRole("button", { name: new RegExp(`^[ABC] ${design}$`) })
			.click();
		await page
			.getByRole("button", { name: "Recent sessions", exact: true })
			.click();
		assert.equal(await page.locator(".session-row").count(), 8);
		await page.screenshot({
			path: resolve(output, `${design}-sessions.png`),
			fullPage: true,
		});
		await page.getByRole("button", { name: "Workspaces", exact: true }).click();
		assert.equal(await page.locator(".workspace-row").count(), 3);
		await page.getByRole("button", { name: "Workspaces", exact: true }).click();
		assert.equal(await page.locator(".workspace-row").count(), 3);
		await page.screenshot({
			path: resolve(output, `${design}-workspaces.png`),
			fullPage: true,
		});
		checks.push(
			`${design}: both sidebar tabs and repeated selected-tab clicks`,
		);
	}
	await page.getByRole("button", { name: "A Focus" }).click();
	await page
		.getByRole("button", { name: "Recent sessions", exact: true })
		.click();
	await page
		.getByRole("button", {
			name: "Actions for Filtrsoft reliability audit",
			exact: true,
		})
		.click();
	await page.getByRole("button", { name: "Pin session", exact: true }).click();
	await page.getByLabel("Agent filter").selectOption("claude");
	await page.getByLabel("Session filter").selectOption("pinned");
	assert.equal(await page.locator(".session-row").count(), 1);
	assert.match(
		await page.locator(".session-row").innerText(),
		/Filtrsoft reliability audit/,
	);
	await page
		.getByRole("button", { name: "Actions for Filtrsoft reliability audit" })
		.click();
	await page.getByRole("button", { name: "Rename", exact: true }).click();
	await page.getByLabel("Session name").fill("Filtrsoft follow-up");
	await page.getByLabel("Session name").press("Enter");
	await page
		.getByRole("button", { name: "Actions for Filtrsoft follow-up" })
		.click();
	await page.getByRole("button", { name: "Archive", exact: true }).click();
	assert.equal(await page.locator(".session-row").count(), 0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	assert.equal(await page.locator(".session-row").count(), 1);
	checks.push("Claude pinning, filters, rename, archive and Undo");
	await page.getByRole("button", { name: "Workspaces", exact: true }).click();
	await page.getByRole("button", { name: "Active only", exact: true }).click();
	assert.equal(await page.locator(".workspace-row").count(), 2);
	await page.getByRole("button", { name: "Active only", exact: true }).click();
	await page.locator(".add-workspace").click();
	await page.getByLabel("Name", { exact: true }).fill("Preview project");
	await page.getByRole("button", { name: "Create", exact: true }).click();
	assert.equal(await page.locator(".workspace-row").count(), 4);
	await page.getByLabel("Search workspaces").fill("unmatched search");
	assert.equal(await page.locator(".workspace-row").count(), 0);
	await page
		.getByRole("button", { name: "Clear filters", exact: true })
		.click();
	checks.push("Workspace creation, active filter and empty-state recovery");
	await page
		.getByRole("button", { name: "Edit message 1", exact: true })
		.click();
	await page
		.getByLabel("Edit queued message", { exact: true })
		.fill("First edited prompt");
	assert.equal(
		await page.getByRole("button", { name: "Finish demo turn" }).isDisabled(),
		true,
	);
	await page.getByRole("button", { name: "Save message" }).click();
	await page
		.getByLabel("Message Codex", { exact: true })
		.fill("Second queued prompt");
	await page.getByLabel("Message Codex", { exact: true }).press("Enter");
	assert.equal(await page.locator(".queued-row").count(), 2);
	await page
		.getByRole("button", { name: "Delete message 2", exact: true })
		.click();
	assert.equal(await page.locator(".queued-row").count(), 1);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	assert.equal(await page.locator(".queued-row").count(), 2);
	await page.getByRole("button", { name: "Finish demo turn" }).click();
	assert.match(
		await page.locator(".conversation-scroll").innerText(),
		/First edited prompt/,
	);
	assert.equal(
		await page.locator(".queued-text").innerText(),
		"Second queued prompt",
	);
	await page.getByRole("button", { name: "Stop demo turn" }).click();
	assert.equal(await page.locator(".queued-row").count(), 1);
	await page.getByRole("button", { name: "Resume queue" }).click();
	assert.equal(await page.locator(".queued-row").count(), 0);
	await page.getByLabel("Composer agent").selectOption("claude");
	await page
		.getByLabel("Message Claude", { exact: true })
		.fill("Claude queued prompt");
	await page
		.getByRole("button", { name: "Queue message", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Send message 1 now", exact: true })
		.click();
	assert.equal(await page.locator(".queued-row").count(), 0);
	assert.match(
		await page.locator(".conversation-scroll").innerText(),
		/Claude queued prompt/,
	);
	checks.push(
		"Queue edit/delete/Undo, FIFO dispatch, stop/pause/resume and Claude send-now",
	);
	await page.getByRole("button", { name: "Reset preview" }).click();
	for (const width of [380, 520, 800, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		for (const area of width < 1000 ? ["Sidebar", "Message queue"] : [null]) {
			if (area)
				await page.getByRole("button", { name: area, exact: true }).click();
			assert.ok(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
				`Overflow at ${width}/${area}`,
			);
			await page.screenshot({
				path: resolve(output, `width-${width}-${area ?? "both"}.png`),
				fullPage: true,
			});
		}
	}
	checks.push("380/520/800/1440px layouts: no horizontal overflow");
	await page.getByRole("button", { name: "Toggle light theme" }).click();
	await page.screenshot({ path: resolve(output, "light.png"), fullPage: true });
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(
		await page
			.locator(".agent-mark.working")
			.first()
			.evaluate((el) => getComputedStyle(el, "::after").animationName),
		"none",
	);
	checks.push("Light theme and reduced motion");
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify({ passed: true, checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ passed: true, checks, errors }));
} finally {
	await browser.close();
}
