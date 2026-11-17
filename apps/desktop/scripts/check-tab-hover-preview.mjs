import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const output = resolve("../../.tmp/tab-hover-preview-check");
await mkdir(output, { recursive: true });
const checks = [],
	errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const box = (selector) => page.locator(selector).boundingBox();
const targets = () =>
	page.locator(".tab-slot").evaluateAll((nodes) =>
		nodes.map((n) => {
			const r = n.getBoundingClientRect();
			return [r.x, r.y, r.width, r.height];
		}),
	);
try {
	await page.goto(
		pathToFileURL(resolve("scripts/tab-hover-preview/index.html")).href,
	);
	await page.getByRole("tab", { name: "College", exact: true }).waitFor();
	const six = await box("#rail");
	await page.getByRole("button", { name: "3", exact: true }).click();
	const three = await box("#rail");
	assert(three.width < six.width - 130);
	const inner = await page.evaluate(() => ({
		viewport: document.querySelector("#tabs").clientWidth,
		content: document.querySelector("#tabs").scrollWidth,
		rail: document.querySelector("#rail").getBoundingClientRect().width,
	}));
	assert.equal(inner.viewport, inner.content);
	checks.push("Rail shrinks to three tabs without an empty scroll region");
	await page.getByRole("button", { name: "6", exact: true }).click();
	const before = await targets();
	await page.getByRole("tab", { name: "College", exact: true }).hover();
	await page.locator("#hover-preview:not([hidden])").waitFor();
	await page.waitForTimeout(280);
	assert.deepEqual(await targets(), before);
	const lift = await page
		.locator('[data-id="college"] .tab-face')
		.evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).m42);
	assert(lift < -0.8 && lift > -1.2);
	assert.equal(await page.locator(".tab-thumbnail").count(), 1);
	for (const name of ["Claude", "Codex", "Gemini"])
		assert.equal(
			await page.locator(`.mini-header img[alt="${name}"]`).count(),
			1,
		);
	assert.equal(
		await page.locator(".preview-providers, .preview-foot").count(),
		0,
	);
	assert((await box("#hover-preview")).height <= 235);
	assert((await box("#hover-preview")).width <= 345);
	checks.push(
		"Subtle lifted visual keeps every click target still; mixed-provider panes are identified",
	);
	await page.screenshot({
		path: resolve(output, "hover-compact-workspace.png"),
	});
	await page
		.getByRole("button", { name: "Open College workspace", exact: true })
		.hover();
	await page.waitForTimeout(350);
	assert(await page.locator("#hover-preview").isVisible());
	await page
		.getByRole("button", { name: "Open College workspace", exact: true })
		.click();
	assert.equal(
		await page.locator(".pane.focused strong").innerText(),
		"Essay revision",
	);
	checks.push("Pointer crosses into compact preview; thumbnail opens its tab");
	await page.getByRole("tab", { name: "College", exact: true }).hover();
	await page.locator("#hover-preview:not([hidden])").waitFor();
	await page.keyboard.press("Escape");
	assert(await page.locator("#hover-preview").isHidden());
	checks.push("Active tab previews too; Escape dismisses");
	await page.getByRole("button", { name: "16 tabs", exact: true }).click();
	assert(await page.locator("#next").isVisible());
	await page.locator("#next").click();
	assert((await page.locator("#tabs").evaluate((n) => n.scrollLeft)) > 0);
	await page.getByRole("tab", { name: "GS Edits", exact: true }).focus();
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	assert.equal(
		await page
			.locator('.tab-hit[aria-selected="true"]')
			.getAttribute("aria-label"),
		"Weekly planning",
	);
	checks.push("Overflow scroll and keyboard navigation reach all 16 tabs");
	await page.getByRole("button", { name: "6", exact: true }).click();
	await page
		.locator('.session-row[data-select="college"]')
		.dragTo(page.locator('.session-row[data-select="workspace"]'));
	assert.equal(
		await page.locator(".session-row").first().getAttribute("data-select"),
		"college",
	);
	checks.push("Recent sessions drag from the entire row");
	const strokes = await page.evaluate(() =>
		[document.querySelector("#rail"), document.querySelector(".composer")].map(
			(n) => getComputedStyle(n).borderTopWidth,
		),
	);
	assert.deepEqual(strokes, ["2px", "2px"]);
	checks.push("Rail and composers share a two-pixel border");
	for (const width of [420, 1180, 1440, 1920]) {
		await page.setViewportSize({ width, height: 900 });
		await page.waitForTimeout(100);
		const rail = await box("#rail"),
			stage = await box("#stage");
		assert(rail.x >= stage.x && rail.x + rail.width <= width + 1);
		assert(Math.abs(rail.x + rail.width / 2 - width / 2) < 1);
	}
	checks.push("Whole-window centering and containment at four viewport widths");
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.getByRole("tab", { name: "GS Edits", exact: true }).hover();
	await page.locator("#hover-preview:not([hidden])").waitFor();
	assert.equal(
		await page
			.locator("#hover-preview")
			.evaluate((n) => n.getAnimations().length),
		0,
	);
	checks.push("Reduced motion removes preview animation");
	await page.getByRole("button", { name: "Reset", exact: true }).click();
	await page
		.getByRole("button", { name: "Show hover demo", exact: true })
		.click();
	await page.waitForTimeout(450);
	assert(await page.locator("#hover-preview").isVisible());
	assert.equal(
		await page.locator(".preview-header strong").innerText(),
		"College",
	);
	checks.push("Hover demo stays visible after its programmatic scroll");
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify({ checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ checks, errors }));
} finally {
	await browser.close();
}
