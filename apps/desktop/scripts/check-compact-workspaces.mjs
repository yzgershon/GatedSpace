import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

const directory = resolve("../../.tmp/compact-workspaces-check");
if (process.env.COMPACT_PACKAGED === "1") {
	const assets = resolve("dist/renderer/assets");
	const styles = readdirSync(assets)
		.filter(
			(file) => file.endsWith(".css") && !file.startsWith("computer-overlay-"),
		)
		.map((file) => readFileSync(resolve(assets, file), "utf8"))
		.join("\n");
	assert.ok(
		styles.includes("compact-session-list") &&
			styles.includes("compact-workspace-header"),
		"Compact workspace styles missing from compiled app",
	);
	writeFileSync(resolve(directory, "style.css"), styles);
}
const server = createServer((request, response) => {
	const file = {
		"/": "index.html",
		"/renderer.js": "renderer.js",
		"/style.css": "style.css",
	}[request.url];
	if (!file) return response.writeHead(404).end();
	response.setHeader(
		"Content-Type",
		file.endsWith(".js")
			? "text/javascript"
			: file.endsWith(".css")
				? "text/css"
				: "text/html",
	);
	response.end(readFileSync(resolve(directory, file)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	await page
		.getByRole("button", { name: "Open Dev workspace", exact: true })
		.waitFor();
	assert.equal(await page.getByText("GS Edits", { exact: true }).count(), 1);
	checks.push("single-session-no-duplicate-title");
	const recency = () => page.getByTestId("recency").textContent();
	const selected = () => page.getByTestId("selection").textContent();
	await page.getByRole("button", { name: "Collapse College sessions" }).click();
	assert.equal(
		await page.getByText("College Claude", { exact: true }).count(),
		0,
	);
	assert.equal(await recency(), "0");
	assert.equal(await selected(), "");
	checks.push("folding-does-not-open-or-reorder");
	await page.getByRole("button", { name: "Expand College sessions" }).focus();
	await page.keyboard.press("Enter");
	await page
		.getByRole("button", { name: "Open College Claude, Idle", exact: true })
		.click();
	assert.equal(await selected(), "claude");
	assert.ok(Number(await recency()) > 0);
	checks.push("keyboard-expand-and-pane-selection");
	await page.getByRole("button", { name: "Collapse Dev sessions" }).click();
	assert.equal(await page.locator(".compact-session-list").count(), 0);
	await page
		.getByRole("button", { name: "Open Dev workspace", exact: true })
		.click();
	assert.equal(await selected(), "workspace");
	assert.equal(await page.locator(".compact-session-list").count(), 0);
	checks.push("workspace-opens-without-toggling-disclosure");
	await page.getByRole("button", { name: "New workspace in Dev" }).click();
	assert.equal(await selected(), "new");
	await page
		.getByRole("button", { name: "Workspace actions", exact: true })
		.click();
	assert.equal(await selected(), "actions");
	checks.push("separate-add-and-actions-targets");
	const savedRecency = await recency();
	await page.getByRole("switch").click();
	assert.equal(await page.getByTestId("recent-first").textContent(), "false");
	await page.reload();
	assert.equal(await page.getByTestId("recent-first").textContent(), "false");
	assert.equal(await recency(), savedRecency);
	checks.push("recency-and-setting-persist-after-reload");
	for (const width of [256, 320, 400, 640]) {
		await page.setViewportSize({ width, height: 800 });
		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
			true,
		);
		assert.equal(
			await page
				.locator(".compact-session-list")
				.evaluate((element) => element.scrollWidth <= element.clientWidth),
			true,
		);
		checks.push(`no-overflow-${width}`);
	}
	assert.equal(
		await page
			.locator(".compact-session-row")
			.first()
			.evaluate((element) => element.getBoundingClientRect().height),
		34,
	);
	assert.equal(
		await page
			.locator(".compact-session-children button")
			.first()
			.evaluate((element) => element.getBoundingClientRect().height),
		29,
	);
	checks.push("compact-row-sizes");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(
		await page
			.locator(".compact-session-open")
			.first()
			.evaluate((element) => getComputedStyle(element).transitionDuration),
		"0s",
	);
	checks.push("reduced-motion");
	assert.deepEqual(errors, []);
	checks.push("no-browser-errors");
	await page.screenshot({
		path: resolve(directory, "verified.png"),
		fullPage: true,
	});
	writeFileSync(
		resolve(directory, "checks.json"),
		JSON.stringify({ passed: true, checks }, null, 2),
	);
	console.log(`${checks.length} compact workspace browser checks passed`);
} finally {
	await browser.close();
	await new Promise((done) => server.close(done));
}
