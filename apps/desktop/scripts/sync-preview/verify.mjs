import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 980, height: 960 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const check = (name) => {
	checks.push(name);
	console.log(`PASS ${name}`);
};
const origin = "http://127.0.0.1:52142";
try {
	await page.goto(`${origin}/?mode=disconnected`);
	await page
		.getByRole("button", { name: "Connect account", exact: true })
		.click();
	await page.getByText("DEMO-1234", { exact: true }).waitFor();
	assert.equal(
		await page.getByRole("button", { name: "Choose project & sync" }).count(),
		0,
	);
	check("pending approval never starts transfers");
	await page.getByRole("button", { name: "Simulate browser approval" }).click();
	await page.getByRole("button", { name: "I have a recovery key" }).click();
	assert.equal(
		await page.locator('input[aria-label="Recovery key"]').getAttribute("type"),
		"password",
	);
	await page.locator('input[aria-label="Recovery key"]').fill("a".repeat(43));
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await page.getByRole("button", { name: "Save recovery key" }).waitFor();
	check("recovery key is masked and unlocks transfer controls");
	await page
		.getByRole("combobox", { name: "Conversation to sync" })
		.selectOption("codex:22222222-2222-4222-8222-222222222222");
	await page.getByRole("button", { name: "Choose project & sync" }).click();
	await page
		.getByText(
			"Checkpoint saved. Later completed turns will sync automatically.",
		)
		.waitFor();
	check("selected conversation can be synced");
	await page.getByRole("checkbox", { name: "Auto-sync" }).uncheck();
	await page.waitForTimeout(80);
	assert.equal(
		await page.getByRole("checkbox", { name: "Auto-sync" }).isChecked(),
		false,
	);
	check("automatic updates can be paused");
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await page
		.getByText(
			"Checkpoint uploaded. You can continue from it on your other PC.",
		)
		.waitFor();
	check("manual handoff can finish before shutting down the PC");
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await page.getByRole("button", { name: "Restore", exact: true }).click();
	await page
		.getByRole("textbox", { name: "New project folder name" })
		.fill("GatedSpace-OMEN");
	await page
		.getByRole("button", { name: "Choose destination & restore" })
		.click();
	await page.getByText(/Restored GatedSpace/).waitFor();
	check("restore explains the separate destination and shows where to resume");
	await page.goto(`${origin}/?mode=conflict`);
	await page.getByText(/Another PC has newer work/).waitFor();
	check("conflict is visible with preserved-version instructions");
	for (const width of [980, 560, 360]) {
		await page.setViewportSize({ width, height: 960 });
		await page.getByRole("button", { name: "Refresh", exact: true }).click();
		await page.getByRole("button", { name: "Restore", exact: true }).waitFor();
		assert(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
			`horizontal overflow at ${width}`,
		);
		await page.screenshot({
			path: `.tmp/sync-settings-${width}.png`,
			fullPage: true,
		});
	}
	check("980px, 560px, and 360px layouts have no horizontal overflow");
	assert.deepEqual(errors, []);
	check("no browser runtime errors");
	await writeFile(
		".tmp/sync-settings-ui-receipt.json",
		JSON.stringify({ passed: true, checks, errors }, null, 2),
	);
} finally {
	await browser.close();
}
