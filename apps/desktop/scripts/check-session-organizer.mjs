import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1050, height: 1100 } });
page.setDefaultTimeout(10_000);
const errors = [];
const checks = [];
const output = resolve("../../.tmp/session-organizer-preview");
await mkdir(output, { recursive: true });
page.on("pageerror", (e) => errors.push(e.message));
const group = (name) =>
	page.locator(".session-project-section").filter({
		has: page.getByRole("button", {
			name: new RegExp(`^${name}, \\d+ sessions?$`),
		}),
	});
const titles = (section) =>
	section.locator(".collection-session-title").allTextContents();
const waitIdle = () =>
	page.waitForSelector('.session-organizer[aria-busy="false"]');
const projectName = `Test project ${Date.now()}`;
async function drag(handle, destination) {
	await handle.scrollIntoViewIfNeeded();
	const a = await handle.boundingBox();
	const b = await destination.boundingBox();
	assert(a && b);
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(a.x + a.width / 2 + 9, a.y + a.height / 2, {
		steps: 3,
	});
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
	await page.mouse.up();
	await waitIdle();
}
try {
	await page.goto(process.env.ORGANIZER_PREVIEW_URL ?? "http://127.0.0.1:8146");
	await page.getByLabel("Agent filter").selectOption("all");
	await page.getByLabel("Session filter").selectOption("all");
	await group("Pinned")
		.getByLabel("Move GatedSpace improvements", { exact: true })
		.waitFor();
	const originalPins = await titles(group("Pinned"));
	assert.equal(originalPins.length, 3);
	await drag(
		group("Pinned").getByLabel(`Move ${originalPins[2]}`, { exact: true }),
		group("Pinned").getByLabel(`Move ${originalPins[0]}`, { exact: true }),
	);
	await page.waitForFunction(
		(title) =>
			document.querySelector('[data-group="@pinned"] .collection-session-title')
				?.textContent === title,
		originalPins[2],
	);
	checks.push("Mouse drag reorders mixed-provider pins");
	await page.reload();
	await group("Pinned").waitFor();
	assert.equal((await titles(group("Pinned")))[0], originalPins[2]);
	checks.push("Pinned order survives refresh");
	const handle = group("Pinned").getByLabel(`Move ${originalPins[2]}`, {
		exact: true,
	});
	await handle.focus();
	await page.keyboard.press("Space");
	await page.locator(".session-drag-preview").waitFor();
	await page.waitForTimeout(100);
	await page.keyboard.press("ArrowDown");
	await page.waitForTimeout(200);
	await page.keyboard.press("Space");
	await waitIdle();
	await page.waitForFunction(
		(title) =>
			document.querySelectorAll(
				'[data-group="@pinned"] .collection-session-title',
			)[1]?.textContent === title,
		originalPins[2],
	);
	checks.push("Keyboard drag reorders pins");
	await page.getByRole("button", { name: "New project", exact: true }).click();
	await page.getByLabel("New project", { exact: true }).fill(projectName);
	await page
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await waitIdle();
	await group(projectName).waitFor();
	checks.push("Creates an empty project");
	await group("Unsorted")
		.getByLabel("Actions for Weekend ideas", { exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: "Move to project", exact: true })
		.hover();
	await page.getByRole("menuitem", { name: projectName, exact: true }).click();
	await waitIdle();
	await group(projectName)
		.getByLabel("Actions for Weekend ideas", { exact: true })
		.waitFor();
	checks.push("Session menu moves a conversation into a project");
	// Bring both targets into view before a drag across sections.
	await page.locator(".collection-list").evaluate((node) => {
		node.scrollTop = 0;
	});
	await drag(
		group("Pinned").getByLabel("Move Filtrsoft reliability audit", {
			exact: true,
		}),
		group("GatedSpace").getByRole("button", { name: /^GatedSpace, / }),
	);
	await group("GatedSpace")
		.getByLabel("Actions for Filtrsoft reliability audit", { exact: true })
		.waitFor();
	assert(
		(await titles(group("Pinned"))).includes("Filtrsoft reliability audit"),
	);
	checks.push("Drag assigns a pinned session without removing its shortcut");
	await page.getByLabel("Search sessions").fill(projectName);
	await page.waitForTimeout(350);
	assert.deepEqual(await titles(group(projectName)), ["Weekend ideas"]);
	checks.push("Search matches a project name and exposes its sessions");
	await page.getByLabel("Clear search").click();
	await group(projectName)
		.getByRole("button", { name: new RegExp(`^${projectName},`) })
		.click();
	await waitIdle();
	await page.reload();
	await group(projectName).waitFor();
	assert.equal(
		await group(projectName)
			.getByRole("button", { name: new RegExp(`^${projectName},`) })
			.getAttribute("aria-expanded"),
		"false",
	);
	checks.push("Project collapse survives refresh");
	await group(projectName)
		.getByLabel(`Project actions for ${projectName}`)
		.click();
	await page
		.getByRole("menuitem", { name: "Rename project", exact: true })
		.click();
	await page
		.getByLabel("Project name", { exact: true })
		.fill(`${projectName} renamed`);
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await waitIdle();
	await page
		.getByLabel("Project name", { exact: true })
		.waitFor({ state: "detached" });
	const renamed = `${projectName} renamed`;
	await group(renamed).waitFor();
	checks.push("Renames a project");
	await group(renamed).getByLabel(`Project actions for ${renamed}`).click();
	await page
		.getByRole("menuitem", { name: "Remove project…", exact: true })
		.click();
	await group(renamed)
		.getByRole("button", { name: "Remove project", exact: true })
		.click();
	await waitIdle();
	await group("Unsorted")
		.getByLabel("Actions for Weekend ideas", { exact: true })
		.waitFor();
	checks.push("Removing a project preserves its conversations in Unsorted");
	// Archive and restore keep the project's membership.
	await group("GatedSpace")
		.getByLabel("Actions for Mobile sign-in investigation")
		.click();
	await page
		.getByRole("menuitem", { name: "Archive session", exact: true })
		.click();
	await page.getByLabel("Session filter").selectOption("archived");
	await group("GatedSpace")
		.getByLabel("Actions for Mobile sign-in investigation")
		.click();
	await page
		.getByRole("menuitem", { name: "Restore session", exact: true })
		.click();
	await page.getByLabel("Session filter").selectOption("all");
	await group("GatedSpace")
		.getByLabel("Actions for Mobile sign-in investigation")
		.waitFor();
	checks.push("Archive and restore retain membership");
	for (const width of [1050, 680, 380, 300]) {
		await page.setViewportSize({ width, height: 1000 });
		await page.waitForTimeout(100);
		const layout = await page.evaluate(() => ({
			width: innerWidth,
			scroll: document.documentElement.scrollWidth,
			list: document.querySelector(".collection-list").getBoundingClientRect()
				.width,
			listScroll: document.querySelector(".collection-list").scrollWidth,
		}));
		assert(
			layout.scroll <= layout.width + 1,
			`Page overflow at ${width}: ${JSON.stringify(layout)}`,
		);
		assert(
			layout.listScroll <= layout.list + 1,
			`Sidebar overflow at ${width}`,
		);
		await page.screenshot({
			path: resolve(output, `organizer-${width}.png`),
			fullPage: true,
		});
	}
	checks.push("No horizontal overflow at 300, 380, 680 and 1050 CSS pixels");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(
		await page
			.locator(
				'.collection-session-row[data-status="working"] .collection-agent-icon',
			)
			.first()
			.evaluate((node) => getComputedStyle(node).animationName),
		"none",
	);
	checks.push("Reduced-motion preference respected");
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ ok: true, checks }, null, 2));
} catch (error) {
	await page.screenshot({
		path: resolve(output, "failure.png"),
		fullPage: true,
	});
	console.error(JSON.stringify({ checks, errors }));
	throw error;
} finally {
	await writeFile(
		resolve(output, "checks.json"),
		JSON.stringify({ checks, errors }, null, 2),
	);
	await browser.close();
}
