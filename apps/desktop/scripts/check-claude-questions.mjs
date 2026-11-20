import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, ".tmp/claude-question-check");
await mkdir(output, { recursive: true });
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>',
);
const store = resolve(desktop, "../../node_modules/.bun");
const playwright = (await readdir(store)).find((name) =>
	name.startsWith("playwright@"),
);
assert.ok(
	playwright,
	"Install project dependencies before running browser checks",
);
const { chromium } = await import(
	pathToFileURL(resolve(store, playwright, "node_modules/playwright/index.mjs"))
);
const server = await createServer({
	configFile: false,
	root: output,
	plugins: [
		react(),
		tailwind(),
		{
			name: "claude-question-fixture",
			enforce: "pre",
			async load(id) {
				if (id === resolve(output, "fixture.tsx").replaceAll("\\", "/"))
					return `import ${JSON.stringify(resolve(desktop, "scripts/claude-questions/renderer.tsx").replaceAll("\\", "/"))}`;
				if (/renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return `export {electronTrpcClient} from ${JSON.stringify(resolve(desktop, "scripts/claude-questions/fixture-client.ts").replaceAll("\\", "/"))};`;
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
	server: {
		host: "127.0.0.1",
		port: 0,
		fs: { allow: [resolve(desktop, "../..")] },
	},
	logLevel: "warn",
});
// An existing entry lets Vite resolve the fixture before the load hook runs.
await writeFile(resolve(output, "fixture.tsx"), "export {};");
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [],
	checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const reset = async (kind) => {
	await page.evaluate((value) => window.questionFixture.reset(value), kind);
	await page
		.getByRole("region", {
			name: kind === "tool" ? "Permission request" : "Claude question",
			exact: true,
		})
		.waitFor();
};
const state = () =>
	page.evaluate(() => ({
		writes: window.questionFixture.writes,
		attempts: window.questionFixture.attempts,
	}));
const sent = async () => {
	await page.waitForFunction(() => window.questionFixture.writes.length === 1);
	return (await state()).writes[0].response.response;
};
try {
	await page.goto(server.resolvedUrls.local[0]);
	await page.waitForFunction(() => Boolean(window.questionFixture));
	await reset("single");
	assert.equal(
		await page.getByRole("button", { name: "Allow once" }).count(),
		0,
	);
	assert.ok(
		await page.getByRole("button", { name: "Send answer" }).isDisabled(),
	);
	await page.getByRole("radio", { name: /^Blue/ }).check();
	assert.equal((await state()).writes.length, 0, "Choosing is not submitting");
	await page.getByRole("button", { name: "Send answer" }).click();
	const result = await sent();
	assert.equal(result.behavior, "allow");
	assert.deepEqual(result.updatedInput.answers, {
		"Which color should I use?": "Blue",
	});
	assert.equal(result.updatedInput.questions[0].header, "Color");
	assert.deepEqual(result.updatedInput.metadata, { fixture: true });
	checks.push("single choice returns original questions plus actual answers");

	await reset("single");
	await page.getByRole("radio", { name: /^Blue/ }).check();
	await page
		.getByRole("textbox")
		.fill("Use teal instead.\nKeep good contrast.");
	assert.equal(
		await page.getByRole("radio", { name: /^Blue/ }).isChecked(),
		false,
	);
	await page.getByRole("button", { name: "Send answer" }).click();
	assert.deepEqual((await sent()).updatedInput.answers, {
		"Which color should I use?": "Use teal instead.\nKeep good contrast.",
	});
	checks.push("custom multiline answer replaces a single choice");

	await reset("multiple");
	await page.getByRole("radio", { name: /^Pink/ }).check();
	assert.ok(
		await page.getByRole("button", { name: "Send answer" }).isDisabled(),
	);
	await page.getByRole("checkbox", { name: "Calendar", exact: true }).check();
	await page.getByRole("checkbox", { name: "Notes", exact: true }).check();
	await page.getByRole("textbox", { name: /features/ }).fill("Search");
	await page.screenshot({ path: resolve(output, "questions-wide.png") });
	await page.setViewportSize({ width: 320, height: 740 });
	assert.ok(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	);
	await page
		.getByRole("button", { name: "Send answer" })
		.scrollIntoViewIfNeeded();
	await page.screenshot({ path: resolve(output, "questions-narrow.png") });
	await page.getByRole("button", { name: "Send answer" }).click();
	assert.deepEqual((await sent()).updatedInput.answers, {
		"Which color should I use?": "Pink",
		"Which features should I include?": "Calendar, Notes, Search",
	});
	checks.push("multiple questions, multi-select and narrow-pane scrolling");

	await page.setViewportSize({ width: 900, height: 1000 });
	await reset("text");
	await page.getByRole("textbox").fill("   ");
	assert.ok(
		await page.getByRole("button", { name: "Send answer" }).isDisabled(),
	);
	await page.getByRole("textbox").fill("Orbit");
	await page.evaluate(() => {
		window.questionFixture.rejectNext = true;
	});
	await page.getByRole("button", { name: "Send answer" }).click();
	await page.getByRole("alert").waitFor();
	assert.equal(await page.getByRole("textbox").inputValue(), "Orbit");
	assert.equal((await state()).writes.length, 0);
	await page.getByRole("button", { name: "Send answer" }).focus();
	await page.keyboard.press("Enter");
	assert.deepEqual((await sent()).updatedInput.answers, {
		"What should I call it?": "Orbit",
	});
	checks.push("failed send retains the draft and keyboard retry delivers it");

	await reset("single");
	await page
		.getByRole("button", { name: "Dismiss question", exact: true })
		.click();
	assert.equal((await sent()).behavior, "deny");
	checks.push("skip is explicit and never fabricates an answer");

	await reset("invalid");
	await page.getByRole("alert").waitFor();
	assert.equal(
		await page.getByRole("button", { name: "Send answer" }).count(),
		0,
	);
	assert.equal(
		await page.getByRole("button", { name: "Allow once" }).count(),
		0,
	);
	await page
		.getByRole("button", { name: "Dismiss question", exact: true })
		.click();
	assert.equal((await sent()).behavior, "deny");
	checks.push("malformed questions cannot fall back to a blank Allow");

	await reset("single");
	await page.evaluate(() => window.questionFixture.cancel());
	await page
		.getByRole("region", { name: "Claude question", exact: true })
		.waitFor({ state: "detached" });
	assert.equal((await state()).writes.length, 0);
	checks.push("provider cancellation removes the pending question");

	await reset("tool");
	await page.getByRole("button", { name: "Allow once" }).click();
	assert.deepEqual(await sent(), {
		behavior: "allow",
		updatedInput: { command: "bun test" },
	});
	checks.push("ordinary tool approval still preserves original input");

	await reset("single");
	await page.evaluate(() => {
		window.questionFixture.holdReply = true;
	});
	await page.getByRole("radio", { name: /^Blue/ }).check();
	await page.getByRole("button", { name: "Send answer" }).dblclick();
	await page.getByRole("button", { name: "Reply sent" }).waitFor();
	assert.ok(
		await page.getByRole("button", { name: "Reply sent" }).isDisabled(),
	);
	assert.equal((await state()).attempts.length, 1);
	checks.push("duplicate clicks and delayed state updates cannot resubmit");
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "result.json"),
		JSON.stringify(
			{
				ok: true,
				checks,
				errors,
				scope:
					"Production question components and native PermissionRequests joined by fixture IPC; no live Claude prompt or installed-app test.",
			},
			null,
			2,
		),
	);
	console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
	await page.screenshot({ path: resolve(output, "failure.png") });
	console.error({ checks, errors });
	throw error;
} finally {
	await browser.close();
	await server.close();
}
