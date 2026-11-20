import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(import.meta.dirname, "..");
const output = resolve(desktop, ".tmp/question-interaction-check");
await mkdir(output, { recursive: true });
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>',
);
await writeFile(resolve(output, "fixture.tsx"), "export {};");
const store = resolve(desktop, "../../node_modules/.bun");
const pkg = (await readdir(store)).find((name) =>
	name.startsWith("playwright@"),
);
assert.ok(pkg);
const { chromium } = await import(
	pathToFileURL(resolve(store, pkg, "node_modules/playwright/index.mjs"))
);
const modulePath = (name) =>
	JSON.stringify(
		resolve(desktop, `scripts/question-interactions/${name}`).replaceAll(
			"\\",
			"/",
		),
	);
if (!process.argv.includes("--skip-build"))
	await build({
		configFile: false,
		root: desktop,
		plugins: [
			react(),
			tailwind(),
			{
				name: "question-interactions",
				enforce: "pre",
				load(id) {
					if (id === resolve(output, "fixture.tsx").replaceAll("\\", "/"))
						return `import ${modulePath("renderer.tsx")}`;
					if (/renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
						return `export {electronTrpcClient} from ${modulePath("fixture-client.ts")};`;
					if (/renderer[/\\]lib[/\\]electron-trpc\.ts$/.test(id))
						return `export {electronTrpc} from ${modulePath("fixture-client.ts")};`;
				},
			},
		],
		resolve: {
			alias: {
				renderer: resolve(desktop, "src/renderer"),
				shared: resolve(desktop, "src/shared"),
			},
		},
		define: { "process.env": "{}" },
		build: {
			outDir: output,
			emptyOutDir: false,
			minify: false,
			lib: {
				entry: resolve(output, "fixture.tsx"),
				formats: ["iife"],
				name: "QuestionInteractions",
				fileName: () => "ui.js",
				cssFileName: "ui",
			},
		},
		logLevel: "warn",
	});
const server = createHttpServer(async (request, response) => {
	const file =
		request.url === "/ui.js"
			? "ui.js"
			: request.url === "/ui.css"
				? "ui.css"
				: "index.html";
	response.setHeader(
		"Content-Type",
		file.endsWith("js")
			? "text/javascript; charset=utf-8"
			: file.endsWith("css")
				? "text/css; charset=utf-8"
				: "text/html; charset=utf-8",
	);
	response.end(await readFile(resolve(output, file)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
	permissions: ["clipboard-read", "clipboard-write"],
	viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
const checks = [],
	errors = [];
page.on("pageerror", (error) => errors.push(error.stack || error.message));
await page.addInitScript(() => {
	window.fixtureErrors = [];
	window.addEventListener("error", (event) =>
		window.fixtureErrors.push({
			message: event.message,
			file: event.filename,
			line: event.lineno,
			column: event.colno,
		}),
	);
});
const composer = (id) =>
	page.locator(`#${id} .session-composer textarea:not([aria-hidden])`);
const reset = async () => {
	await page.evaluate(() => window.interactionFixture.reset());
	await page.getByLabel("Your answer: Which color?", { exact: true }).waitFor();
};
const paste = async (target, text) => {
	await target.click();
	await page.evaluate((value) => navigator.clipboard.writeText(value), text);
	await target.press("Control+V");
};
try {
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	await composer("other-codex").waitFor();
	await reset();
	await page
		.getByLabel("Your answer: Which color?", { exact: true })
		.fill("Codex draft answer");
	await page
		.getByLabel("Your answer: What should I call it?", { exact: true })
		.fill("Claude draft answer");
	for (const id of ["question-codex", "question-claude", "other-codex"]) {
		const input = composer(id);
		await input.fill("");
		await paste(input, `Pasted in ${id}`);
		await page.evaluate(() => window.interactionFixture.pulse());
		await page.keyboard.type(" plus typing");
		assert.equal(await input.inputValue(), `Pasted in ${id} plus typing`);
		assert.ok(await input.evaluate((el) => document.activeElement === el));
	}
	assert.equal(
		await page
			.getByLabel("Your answer: Which color?", { exact: true })
			.inputValue(),
		"Codex draft answer",
	);
	assert.equal(
		await page
			.getByLabel("Your answer: What should I call it?", { exact: true })
			.inputValue(),
		"Claude draft answer",
	);
	checks.push(
		"question updates preserve focus, real clipboard paste, and isolated drafts in all three composers",
	);
	await page.screenshot({
		path: resolve(output, "questions-and-composers.png"),
	});
	for (const id of ["question-codex", "question-claude"]) {
		await reset();
		await composer(id).fill(`New direction for ${id}`);
		await page
			.locator(`#${id}`)
			.getByRole("button", {
				name: id === "question-codex" ? "Send message" : "Send",
				exact: true,
			})
			.click();
		await page.waitForFunction(
			(key) => window.interactionFixture.sent.some((m) => m.key === key),
			id,
		);
		assert.equal(await composer(id).inputValue(), "");
	}
	checks.push(
		"both main composers send new directions immediately during pending questions",
	);
	await reset();
	await composer("question-claude").fill("Keep this failed draft");
	await page.evaluate(() => {
		window.interactionFixture.failSend = true;
	});
	await page
		.locator("#question-claude")
		.getByRole("button", { name: "Send", exact: true })
		.click();
	await page
		.getByText("Send failed; your draft is kept.", { exact: true })
		.waitFor();
	assert.equal(
		await composer("question-claude").inputValue(),
		"Keep this failed draft",
	);
	assert.equal(
		await page
			.getByLabel("Your answer: What should I call it?", { exact: true })
			.count(),
		1,
	);
	checks.push("Claude failed delivery preserves the question and main draft");
	await reset();
	await composer("question-codex").fill("Slow send");
	await page.evaluate(() => {
		window.interactionFixture.holdSend = true;
	});
	await page
		.locator("#question-codex")
		.getByRole("button", { name: "Send message", exact: true })
		.click();
	await composer("other-codex").click();
	await page.evaluate(() => {
		window.interactionFixture.holdSend = false;
	});
	await page.waitForFunction(() => window.interactionFixture.sent.length === 1);
	assert.ok(
		await composer("other-codex").evaluate(
			(el) => document.activeElement === el,
		),
	);
	checks.push("a delayed send cannot steal focus from another pane");
	await reset();
	await page
		.getByRole("button", { name: "Dismiss question", exact: true })
		.first()
		.click();
	await page.waitForFunction(() => !window.interactionFixture.approval);
	assert.equal(
		(await page.evaluate(() => window.interactionFixture.answers))[0].allow,
		false,
	);
	await page
		.locator("#question-claude")
		.getByRole("button", { name: "Dismiss question", exact: true })
		.click();
	await page.waitForFunction(
		() => window.interactionFixture.claude.writes.length === 1,
	);
	assert.equal(
		(await page.evaluate(() => window.interactionFixture.claude.writes))[0]
			.response.response.behavior,
		"deny",
	);
	checks.push(
		"both visible dismiss actions send a dismissal, never a selected default",
	);
	await reset();
	await page.setViewportSize({ width: 1000, height: 800 });
	for (const id of ["question-codex", "question-claude", "other-codex"]) {
		assert.ok(
			await page
				.locator(`#${id}`)
				.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
			`${id} fits a narrow pane`,
		);
		await composer(id).fill("Narrow pane still works");
		assert.equal(await composer(id).inputValue(), "Narrow pane still works");
	}
	await page
		.locator("#question-codex")
		.getByRole("button", { name: "Dismiss question", exact: true })
		.click();
	await page
		.locator("#question-claude")
		.getByRole("button", { name: "Dismiss question", exact: true })
		.click();
	checks.push(
		"narrow question cards stay contained and keep both dismiss and composer controls reachable",
	);
	await reset();
	await page.evaluate(() => {
		window.interactionFixture.approval.method = "mcpServer/elicitation/request";
		window.interactionFixture.pulse();
	});
	await page
		.locator("#question-codex")
		.getByRole("button", { name: "Dismiss question", exact: true })
		.click();
	assert.equal(
		(await page.evaluate(() => window.interactionFixture.answers))[0].allow,
		false,
	);
	await reset();
	await page.evaluate(() => {
		window.interactionFixture.approval.method =
			"item/commandExecution/requestApproval";
		window.interactionFixture.approval.questions = [];
		window.interactionFixture.pulse();
	});
	await page
		.locator("#question-codex")
		.getByRole("button", { name: "Allow once", exact: true })
		.waitFor();
	assert.equal(
		await page
			.locator("#question-codex")
			.getByRole("button", { name: "Dismiss question", exact: true })
			.count(),
		0,
	);
	checks.push(
		"MCP question forms can be dismissed while ordinary tool permissions retain their explicit controls",
	);
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "result.json"),
		JSON.stringify(
			{
				ok: true,
				checks,
				errors,
				scope:
					"Production question cards and composers with simulated IPC; no live provider or installed-app test.",
			},
			null,
			2,
		),
	);
	console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
	await page.screenshot({ path: resolve(output, "failure.png") });
	console.error({ checks, errors });
	console.error(await page.evaluate(() => window.fixtureErrors));
	throw error;
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
