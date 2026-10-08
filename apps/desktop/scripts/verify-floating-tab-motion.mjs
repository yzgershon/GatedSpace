import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const output = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../.tmp/floating-tabs-preview",
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const url = (await readFile(resolve(output, "url.txt"), "utf8")).trim();
const rail = page.locator(".gs-tabrail");
const sample = (frames) =>
	page.evaluate(
		(frames) =>
			new Promise((resolve) => {
				const rows = [];
				const tick = (t) => {
					const nodes = [...document.querySelectorAll("[data-rail-tab]")];
					rows.push({
						t,
						expanded: nodes.find((e) => e.dataset.expanded === "true")
							?.textContent,
						widths: nodes.map((e) => e.getBoundingClientRect().width),
						scroll: document.querySelector(".gs-tabrail-scroll").scrollLeft,
					});
					if (rows.length < frames) requestAnimationFrame(tick);
					else resolve(rows);
				};
				requestAnimationFrame(tick);
			}),
		frames,
	);
const rest = async () => {
	await sample(25);
};
const checks = [];
try {
	await page.goto(url);
	await page.getByLabel("Available width").fill("440");
	await rest();
	const before = await rail.locator("[data-rail-tab]").first().boundingBox();
	assert.ok(before.width > 115 && before.width < 150);
	const target = await rail
		.getByRole("button", { name: "Filtrsoft", exact: true })
		.boundingBox();
	const tracePromise = sample(65);
	await page.mouse.move(
		target.x + target.width / 2,
		target.y + target.height / 2,
	);
	const trace = await tracePromise;
	assert.equal(trace.at(-1).expanded, "Filtrsoft");
	const between = trace.filter(
		(r) => r.widths[0] > 41 && r.widths[0] < before.width - 1,
	);
	assert.ok(
		between.length >= 3,
		"Collapse has intermediate widths instead of a snap",
	);
	const end = trace.at(-1).widths[0];
	assert.ok(Math.abs(end - 40) < 0.6);
	const eligible = trace
		.slice(1)
		.map((r, i) => ({
			dt: r.t - trace[i].t,
			jump: Math.abs(r.widths[0] - trace[i].widths[0]),
		}))
		.filter((r) => r.dt < 25);
	assert.ok(
		eligible.every((r) => r.jump < 45),
		"No one-frame collapse",
	);
	assert.equal(
		new Set(trace.filter((r) => r.t > trace[0].t + 400).map((r) => r.expanded))
			.size,
		1,
		"Stationary pointer does not churn expansion",
	);
	assert.ok(
		trace.every((r) => r.scroll === trace[0].scroll),
		"Hover does not scroll against the pointer",
	);
	checks.push(
		"Measured frame-by-frame: intermediate collapse widths, no snap/overshoot, stable stationary hover and scroll",
	);
	for (const dx of [1, -1, 2, -2, 0]) {
		await page.mouse.move(
			target.x + target.width / 2 + dx,
			target.y + target.height / 2,
		);
		await sample(3);
	}
	assert.equal(
		await rail.locator("[data-expanded=true]").textContent(),
		"Filtrsoft",
	);
	const box = await rail.locator("[data-expanded=true]").boundingBox();
	await page.mouse.move(box.x + 15, box.y - 12);
	await sample(3);
	await page.mouse.move(box.x + 15, box.y + 20);
	await sample(8);
	assert.equal(
		await rail.locator("[data-expanded=true]").textContent(),
		"Filtrsoft",
	);
	await page.mouse.move(5, 5);
	await rest();
	assert.equal(
		await rail.locator("[data-expanded=true]").textContent(),
		"GS Edits",
	);
	checks.push(
		"Tiny pointer wiggles and brief leave/re-entry preserve hover; full exit restores active tab",
	);
	await page.getByLabel("Available width").fill("680");
	await rest();
	const boxes = await rail.locator("[data-rail-tab]").evaluateAll((es) =>
		es.map((e) => {
			const b = e.getBoundingClientRect();
			return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
		}),
	);
	const sweepPromise = sample(55);
	for (const b of boxes.slice(1)) await page.mouse.move(b.x, b.y);
	const sweep = await sweepPromise;
	assert.deepEqual(
		[...new Set(sweep.map((r) => r.expanded))],
		["GS Edits", "Research"],
		"Passing over tabs does not open every one",
	);
	checks.push(
		"Rapid sweep skips intermediate tabs and settles only on intended final tab",
	);
	await page.getByRole("button", { name: "Reset tabs" }).click();
	await rest();
	await page.setViewportSize({ width: 360, height: 800 });
	await rest();
	const frame = await rail.boundingBox();
	for (const name of ["Previous tabs", "Next tabs", "New group"]) {
		const b = await rail
			.getByRole("button", { name, exact: true })
			.boundingBox();
		assert.ok(b.x >= frame.x && b.x + b.width <= frame.x + frame.width + 1);
	}
	await page.emulateMedia({ reducedMotion: "reduce" });
	await rail.getByRole("button", { name: "Filtrsoft", exact: true }).hover();
	await rest();
	assert.equal(
		await rail
			.locator(".gs-tabrail-label")
			.nth(1)
			.evaluate((e) => getComputedStyle(e).transitionDuration),
		"0s",
	);
	assert.deepEqual(errors, []);
	checks.push(
		"Controls contained at 360px, reduced-motion disables animation, no page errors",
	);
	await writeFile(
		resolve(output, "motion-results.json"),
		JSON.stringify({ ok: true, checks, trace, sweep }, null, 2),
	);
	console.log(JSON.stringify({ ok: true, checks }));
} catch (e) {
	await page.screenshot({
		path: resolve(output, "motion-failure.png"),
		fullPage: true,
	});
	console.error(errors);
	throw e;
} finally {
	await browser.close();
}
