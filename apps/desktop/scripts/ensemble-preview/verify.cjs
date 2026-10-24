/** Read-only UI checks against the development bridge; setup/control mutations use fixtures. */
const assert = require("node:assert/strict");
const {
	readFileSync,
	readdirSync,
	mkdirSync,
	writeFileSync,
} = require("node:fs");
const { resolve, join } = require("node:path");

const root = resolve(__dirname, "../../../..");
const packages = join(root, "node_modules/.bun");
const playwright = readdirSync(packages).find((name) =>
	/^playwright@/.test(name),
);
if (!playwright)
	throw new Error("Install the repository's Playwright dependency first.");
const { chromium } = require(
	join(packages, playwright, "node_modules/playwright"),
);
const { url } = JSON.parse(
	readFileSync(join(root, ".tmp/ensemble-live/preview.json"), "utf8"),
);
const output = join(root, ".tmp/flock-verification");
mkdirSync(output, { recursive: true });

(async () => {
	const browser = await chromium.launch({ channel: "msedge", headless: true });
	const context = await browser.newContext({
		viewport: { width: 1100, height: 850 },
	});
	const page = await context.newPage();
	page.setDefaultTimeout(10000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	let fixture = null;
	const commands = [];
	await page.route("**/snapshot", async (route) =>
		fixture ? route.fulfill({ json: fixture }) : route.continue(),
	);
	await page.route("**/command", async (route) => {
		const body = route.request().postDataJSON();
		if (!fixture && body.action === "conversation") return route.continue();
		if (!fixture) throw new Error(`Refusing live mutation: ${body.action}`);
		commands.push(body);
		let value;
		if (body.action === "control")
			fixture.groups[0].status =
				body.input.action === "pause" ? "paused" : "running";
		if (body.action === "createSession")
			value = {
				key: `fixture-${commands.length}`,
				conversationId: null,
				provider: body.input.provider,
				cwd: "C:/fixture",
				workspaceId: body.input.workspaceId,
				title: "Fixture session",
				role: "Contributor",
				status: "idle",
			};
		if (body.action === "create") value = "fixture-created-group";
		if (body.action === "conversation")
			value = { title: "Fixture conversation", messages: [] };
		await route.fulfill({ json: { value } });
	});
	const checkLayout = async (label) => {
		const issues = await page.evaluate(() => {
			const width = innerWidth;
			const root = document.querySelector(".ensemble-workspace");
			const failures = [];
			if (document.documentElement.scrollWidth > width + 1)
				failures.push("document overflow");
			for (const selector of [
				".en-feature-toolbar",
				".en-view-tabs",
				".en-setup-footer",
				".en-composer",
				".en-roster-fields",
			]) {
				for (const element of root.querySelectorAll(selector)) {
					const rect = element.getBoundingClientRect();
					if (rect.width && (rect.left < -1 || rect.right > width + 1))
						failures.push(`${selector} is clipped`);
				}
			}
			const footer = document
				.querySelector(".en-setup-footer")
				?.getBoundingClientRect();
			if (footer && (footer.bottom > innerHeight + 1 || footer.top < 0))
				failures.push("setup actions are outside viewport");
			return failures;
		});
		assert.deepEqual(issues, [], label);
	};
	try {
		await page.goto(url);
		await page
			.getByRole("button", { name: "Read the result", exact: true })
			.waitFor();
		const live = await page.evaluate(async () =>
			(await fetch("/snapshot")).json(),
		);
		assert.equal(live.groups.at(-1).status, "completed");
		for (const width of [320, 600, 900, 1440]) {
			await page.setViewportSize({ width, height: 850 });
			await checkLayout(`completed overview ${width}`);
			await page.screenshot({ path: join(output, `overview-${width}.png`) });
		}
		await page.setViewportSize({ width: 1100, height: 850 });
		const overview = page.getByRole("tab", { name: "Overview", exact: true });
		await overview.focus();
		await page.keyboard.press("ArrowRight");
		assert.equal(
			await page
				.getByRole("tab", { name: "Shared work", exact: true })
				.getAttribute("aria-selected"),
			"true",
		);
		await page.getByLabel("Artifact revision").selectOption("0");
		assert.match(
			await page.locator(".en-reviews").innerText(),
			/NEEDS CHANGES/,
		);
		await page.getByLabel("Artifact revision").selectOption("1");
		assert.match(await page.locator(".en-reviews").innerText(), /READY/);
		await page.screenshot({ path: join(output, "reviewed-artifact.png") });
		await page.getByRole("tab", { name: "Overview", exact: true }).click();
		const firstExchange = page.locator(".en-exchange > summary").first();
		await firstExchange.click();
		assert.equal(
			await page.locator(".en-exchange").first().getAttribute("open"),
			"",
		);
		await firstExchange.press("Enter");
		await page.waitForFunction(
			() => !document.querySelector(".en-exchange").open,
		);
		await page.locator(".en-agent").nth(1).click();
		await page
			.getByRole("button", { name: "Open conversation", exact: true })
			.click();
		await page.locator("dialog").waitFor();
		assert.match(await page.locator("dialog").innerText(), /Borrowed/i);
		await page
			.getByRole("button", { name: "Close conversation", exact: true })
			.click();
		// Exercise blocked/paused and intervention controls with isolated responses, never real provider sends.
		fixture = structuredClone(live);
		fixture.groups[0].status = "running";
		delete fixture.groups[0].result;
		fixture.sessions[1].status = "attention";
		await page.reload();
		await page.getByText(/needs your input/).waitFor();
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
		const composer = page.locator(".en-composer textarea");
		await composer.fill("Make the first action more concrete.");
		await page.locator(".en-composer button[type=submit]").click();
		assert.equal(commands.at(-1).action, "message");
		assert.equal(
			commands.at(-1).input.text,
			"Make the first action more concrete.",
		);
		await page.getByRole("button", { name: "Resume", exact: true }).click();
		await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
		// Setup wizard: invalid brief, presets, provider/coordinator, references and final payload.
		fixture.groups = [];
		await page.reload();
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await page.getByRole("alert").filter({ hasText: "Add a goal" }).waitFor();
		await page
			.getByLabel("Goal", { exact: true })
			.fill("Plan a welcoming neighborhood repair workshop.");
		await page
			.getByLabel("Definition of done", { exact: true })
			.fill("A reviewed one-page plan with a practical first action.");
		await page.getByLabel("Choose shared reference files").setInputFiles({
			name: "brief.md",
			mimeType: "text/markdown",
			buffer: Buffer.from("Six tables and two volunteer mentors."),
		});
		await page.locator(".en-context-file").waitFor();
		assert.match(
			await page.locator(".en-context-file").innerText(),
			/brief\.md/,
		);
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await page.getByRole("button", { name: /Full team/ }).click();
		assert.equal(await page.locator(".en-roster-row").count(), 5);
		await page.getByRole("button", { name: /Pair/ }).click();
		assert.equal(await page.locator(".en-roster-row").count(), 2);
		await page
			.getByLabel("Session", { exact: true })
			.selectOption("new:claude");
		await page.locator(".en-roster-toggle").nth(1).click();
		await page.getByLabel("Session", { exact: true }).selectOption("new:codex");
		await page
			.getByRole("button", { name: "Make coordinator", exact: true })
			.click();
		for (const width of [320, 600, 900, 1440]) {
			await page.setViewportSize({ width, height: 850 });
			await checkLayout(`roster ${width}`);
			await page.screenshot({ path: join(output, `roster-${width}.png`) });
		}
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await checkLayout("launch");
		await page.getByRole("button", { name: "Save draft", exact: true }).click();
		await page.waitForFunction(
			() => !document.querySelector(".en-setup-body[inert]"),
		);
		const created = commands.findLast((c) => c.action === "create");
		assert.equal(created.input.commanderIndex, 1);
		assert.deepEqual(
			created.input.members.map((m) => m.provider),
			["claude", "codex"],
		);
		assert.equal(
			created.input.context[0].text,
			"Six tables and two volunteer mentors.",
		);
		assert.ok(created.input.agreements.includes("review"));
		fixture = structuredClone(live);
		fixture.groups[0].status = "running";
		delete fixture.groups[0].result;
		fixture.sessions[0].status = "working";
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.reload();
		await page.locator(".en-agent").first().waitFor();
		const animated = await page.evaluate(
			() =>
				[...document.querySelectorAll(".ensemble-workspace *")].filter(
					(el) => getComputedStyle(el).animationName !== "none",
				).length,
		);
		assert.equal(animated, 0);
		assert.deepEqual(errors, []);
		const report = {
			recordedLive: {
				group: live.groups.at(-1).id,
				deliveries: live.groups.at(-1).messages.length,
				status: "completed",
				revisions: 2,
			},
			ui: [
				"320/600/900/1440 layout",
				"keyboard tabs",
				"expand/collapse exchanges",
				"revision-bound reviews",
				"native conversation read",
				"setup references and payload",
				"pause/resume and intervention controls (fixture)",
				"reduced motion",
			],
			providerMutationsDuringCheck: 0,
			pageErrors: errors,
		};
		writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
		console.log(JSON.stringify(report, null, 2));
	} catch (error) {
		await page
			.screenshot({ path: join(output, "failure.png") })
			.catch(() => {});
		writeFileSync(
			join(output, "failure.txt"),
			await page.locator("body").innerText(),
		);
		throw error;
	} finally {
		await browser.close();
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
