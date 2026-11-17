import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyTabMerging } from "./composer-layout/verify-tab-merging.mjs";

const app = resolve(import.meta.dirname, "..").replaceAll("\\", "/");
const req = createRequire(`${app}/package.json`);
const { build } = await import(pathToFileURL(req.resolve("vite")));
const { default: react } = await import(
	pathToFileURL(req.resolve("@vitejs/plugin-react"))
);
const { default: tailwind } = await import(
	pathToFileURL(req.resolve("@tailwindcss/vite"))
);
const bunStore = resolve(app, "../../node_modules/.bun");
const playwrightPackage = (await readdir(bunStore)).find((name) =>
	name.startsWith("playwright@"),
);
if (!playwrightPackage)
	throw new Error(
		"Install workspace dependencies before running this browser check.",
	);
const { _electron } = await import(
	pathToFileURL(
		resolve(bunStore, playwrightPackage, "node_modules/playwright/index.mjs"),
	)
);
const out = resolve(app, "../../.tmp/composer-layout-verification").replaceAll(
	"\\",
	"/",
);
await mkdir(out, { recursive: true });
const fixture = `import {electronTrpcClient as controls} from '${app}/scripts/controls-preview/mock';
import {electronTrpcClient as base, electronTrpc as baseHooks} from '${app}/scripts/account-usage-preview/fixture';
export const state={sent:[],version:{version:'1.18.57',isDev:false}};Object.assign(window,{polishFixture:state});
export const electronTrpcClient={...base,codexSession:{...base.codexSession,send:{mutate:async(input)=>{state.sent.push(input);return {};}}},window:controls.window,claudeSession:{...base.claudeSession,models:{query:async()=>[]}}};
export const electronTrpc={...baseHooks,diagnostics:{appVersion:{useQuery:()=>({data:state.version})}}};`;
const renderer = await readFile(
	`${app}/scripts/composer-layout/fixture.tsx`,
	"utf8",
);
await writeFile(`${out}/ui-entry.tsx`, renderer);
if (!process.argv.includes("--skip-build"))
	await build({
		configFile: false,
		envFile: false,
		logLevel: "error",
		plugins: [
			react(),
			tailwind(),
			{
				name: "fixture",
				enforce: "pre",
				resolveId(id) {
					if (id === "virtual:fixture" || id === "virtual:renderer")
						return `\0${id}`;
				},
				load(id) {
					if (id === "\0virtual:fixture") return fixture;
					if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
						return `export {electronTrpcClient} from 'virtual:fixture'`;
					if (/[/\\]renderer[/\\]lib[/\\]electron-trpc\.ts$/.test(id))
						return `export {electronTrpc} from 'virtual:fixture'`;
					if (id === "\0virtual:renderer") return renderer;
				},
				transform(code, id) {
					if (id === "\0virtual:renderer")
						return import(pathToFileURL(req.resolve("esbuild"))).then(
							({ transform }) =>
								transform(code, { loader: "tsx", jsx: "automatic" }),
						);
				},
			},
		],
		resolve: {
			alias: {
				"renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider": `${app}/scripts/controls-preview/mock.ts`,
				"renderer/hooks/host-service/useV2NotificationStatus": `${app}/scripts/controls-preview/mock.ts`,
				react: `${app}/node_modules/react`,
				"react-dom": `${app}/node_modules/react-dom`,
				"@superset/ui/icons/preset-icons": req.resolve(
					"@superset/ui/icons/preset-icons",
				),
				"@superset/ui/tooltip": req.resolve("@superset/ui/tooltip"),
				"@superset/ui/button": req.resolve("@superset/ui/button"),
				"@superset/ui/dialog": req.resolve("@superset/ui/dialog"),
				"@superset/panes": req.resolve("@superset/panes"),
				"react-dnd": req.resolve("react-dnd"),
				"react-dnd-html5-backend": req.resolve("react-dnd-html5-backend"),
				"@tanstack/react-query": req.resolve("@tanstack/react-query"),
				renderer: `${app}/src/renderer`,
				shared: `${app}/src/shared`,
			},
		},
		define: {
			"process.env": "{}",
			"process.platform": JSON.stringify(process.platform),
		},
		build: {
			outDir: out,
			emptyOutDir: false,
			minify: false,
			lib: {
				entry: `${out}/ui-entry.tsx`,
				formats: ["iife"],
				name: "ComposerLayout",
				fileName: () => "ui.js",
				cssFileName: "ui",
			},
		},
	});
await writeFile(
	`${out}/index.html`,
	'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./ui.css"></head><body style="background:#282a36;color:#f8f8f2"><div id="root"></div><script src="./ui.js"></script></body></html>',
);

// Hidden Electron, separate profile: this exercises Chromium editing/undo and
// the bundled dictionary, never the installed running app.
await writeFile(
	`${out}/main.cjs`,
	`const {app,BrowserWindow}=require('electron');app.setPath('userData',__dirname+'/profile');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1240,height:880,webPreferences:{sandbox:true,spellcheck:true,backgroundThrottling:false,offscreen:true}});w.webContents.session.setSpellCheckerLanguages(['en-US']);w.loadFile(__dirname+'/index.html');});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electron = await _electron.launch({
	executablePath: req("electron"),
	args: [`${out}/main.cjs`],
	env,
});
const page = await electron.firstWindow();
const errors = [],
	passed = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(15000);
const pause = () => page.waitForTimeout(250);
try {
	await page.locator("#codex textarea:not([aria-hidden])").waitFor();
	await page.evaluate(() => window.layoutFixture.warmDictionary());
	assert(
		(
			await page.evaluate(() => window.layoutFixture.suggestions("attachemnt"))
		).includes("attachment"),
	);
	passed.push(
		"Bundled offline English dictionary supplies spelling suggestions",
	);
	const rail = page.locator(".gs-tabrail");
	for (const zoom of [1, 1.25, 1.5]) {
		await electron.evaluate(
			({ BrowserWindow }, zoom) =>
				BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),
			zoom,
		);
		for (const title of [
			"Portfolio",
			"Yuta",
			"WWWWWWWWWWWWWWW",
			"A long project title",
		]) {
			await rail.getByRole("button", { name: title, exact: true }).click();
			await pause();
			const label = rail.locator("[data-active=true] .gs-tabrail-label");
			assert.equal(
				(await label.innerText()).split("\n")[0],
				title.length > 15 ? `${title.slice(0, 15)}...` : title,
			);
			assert(
				await label.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
				"Selected name is completely visible",
			);
		}
	}
	passed.push(
		"Full 15-character titles and explicit ellipsis at 100%, 125%, 150% zoom",
	);
	await electron.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
	);
	await rail.getByRole("button", { name: "Portfolio", exact: true }).click();
	await pause();
	const rects = () =>
		rail.locator("[data-rail-tab]").evaluateAll((ns) =>
			ns.map((n) => {
				const r = n.getBoundingClientRect();
				return [r.x, r.y, r.width, r.height];
			}),
		);
	const before = await rects();
	await rail.getByRole("button", { name: "Yuta", exact: true }).hover();
	await page.waitForTimeout(600);
	assert.deepEqual(await rects(), before);
	await page.screenshot({ path: `${out}/hover.png` });
	const lift = await rail
		.getByRole("button", { name: "Yuta", exact: true })
		.evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).m42);
	assert(lift <= -0.9 && lift >= -1.1, `Hover lift: ${lift}`);
	passed.push("Hover lifts only 1px; all click targets stay fixed");
	const codex = page.locator("#codex textarea:not([aria-hidden])");
	const claude = page.locator("#claude textarea:not([aria-hidden])");
	await codex.click();
	await pause();
	const border = (p) =>
		page.locator(`#${p} .session-composer`).evaluate((n) => ({
			color: getComputedStyle(n).borderColor,
			shadow: getComputedStyle(n).boxShadow,
		}));
	assert.equal((await border("claude")).shadow, "none");
	assert.notEqual((await border("codex")).shadow, "none");
	const ring = await page
		.locator("[data-pane-active=true] > [aria-hidden=true]")
		.last()
		.getAttribute("style");
	assert(ring.includes("#8095ff"));
	await claude.click();
	await pause();
	assert.equal((await border("codex")).shadow, "none");
	assert.notEqual((await border("claude")).shadow, "none");
	passed.push(
		"Actual workspace focus moves composer highlight; Codex frame uses icon blue",
	);
	// Resize the real split all the way to each limit. The frame must fit
	// INSIDE its padded leaf, or the panel clips its right/bottom corners.
	for (const zoom of [1, 1.5]) {
		await electron.evaluate(
			({ BrowserWindow }, z) =>
				BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z),
			zoom,
		);
		for (const direction of ["horizontal", "vertical"]) {
			await page.evaluate((direction) => {
				const store = window.layoutFixture.store;
				store.setState((state) => ({
					tabs: state.tabs.map((tab) =>
						tab.id === state.activeTabId
							? {
									...tab,
									layout: { ...tab.layout, direction, splitPercentage: 50 },
								}
							: tab,
					),
				}));
			}, direction);
			for (const key of ["Home", "End"]) {
				const divider = page.getByRole("separator");
				await divider.focus();
				await divider.press(key);
				await pause();
				const frames = await page
					.locator("[data-pane-id]")
					.evaluateAll((panes) =>
						panes.map((pane) => {
							const r = pane.getBoundingClientRect();
							const parent = pane.parentElement;
							const p = parent.getBoundingClientRect();
							const style = getComputedStyle(parent);
							const panel = pane
								.closest("[data-panel]")
								.getBoundingClientRect();
							return {
								id: pane.dataset.paneId,
								width: panel.width,
								height: panel.height,
								rightOverflow:
									r.right - p.right + Number.parseFloat(style.paddingRight),
								bottomOverflow:
									r.bottom - p.bottom + Number.parseFloat(style.paddingBottom),
								radius: getComputedStyle(pane).borderTopRightRadius,
							};
						}),
					);
				assert.equal(frames.length, 2);
				assert(
					frames.some((f) =>
						direction === "horizontal" ? f.width <= 261 : f.height <= 161,
					),
					"Divider reached the minimum pane size",
				);
				for (const frame of frames) {
					assert(
						Math.abs(frame.rightOverflow) < 1,
						`${direction} ${key} ${zoom}: clipped right edge ${JSON.stringify(frame)}`,
					);
					assert(
						Math.abs(frame.bottomOverflow) < 1,
						`${direction} ${key} ${zoom}: clipped bottom edge ${JSON.stringify(frame)}`,
					);
					assert.equal(frame.radius, "12px");
				}
				if (zoom === 1 && key === "End")
					await page.screenshot({ path: `${out}/minimum-${direction}.png` });
			}
		}
	}
	await electron.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
	);
	await page.evaluate(() => {
		const store = window.layoutFixture.store;
		store.setState((state) => ({
			tabs: state.tabs.map((tab) => ({
				...tab,
				layout: { ...tab.layout, direction: "horizontal", splitPercentage: 50 },
			})),
		}));
	});
	await pause();
	passed.push(
		"Rounded pane frames fit at both horizontal and vertical resize limits at 100% and 150% zoom",
	);
	const png = Buffer.from(
		await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 160;
			canvas.height = 100;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#8095ff";
			ctx.fillRect(0, 0, 160, 100);
			ctx.fillStyle = "#e4e4e0";
			ctx.font = "18px sans-serif";
			ctx.fillText("Attachment", 16, 55);
			return canvas.toDataURL("image/png").split(",")[1];
		}),
		"base64",
	);
	for (const provider of ["codex", "claude"]) {
		await page.locator(`#${provider} input[type=file]`).setInputFiles(
			Array.from({ length: 20 }, (_, i) => ({
				name: `screenshot-${i + 1}.png`,
				mimeType: "image/png",
				buffer: png,
			})),
		);
		await page.waitForFunction(
			(p) =>
				document.querySelectorAll(`#${p} .session-image-tile`).length === 20,
			provider,
		);
	}
	for (const width of [1240, 800]) {
		await electron.evaluate(
			({ BrowserWindow }, w) =>
				BrowserWindow.getAllWindows()[0].setSize(w, 880),
			width,
		);
		await pause();
		for (const provider of ["codex", "claude"]) {
			const strip = page.locator(`#${provider} .session-images`);
			const dims = await strip.evaluate((n) => ({
				width: n.clientWidth,
				scroll: n.scrollWidth,
				height: n.getBoundingClientRect().height,
				right: n.getBoundingClientRect().right,
				pane: n.closest("[data-pane-id]").getBoundingClientRect().right,
			}));
			assert(dims.scroll > dims.width);
			assert(dims.height <= 85);
			assert(dims.right <= dims.pane);
			await strip.hover();
			await page.mouse.wheel(0, 4000);
			await pause();
			assert(
				await strip.evaluate(
					(n) => n.scrollLeft + n.clientWidth >= n.scrollWidth - 2,
				),
			);
			await strip
				.getByRole("button", { name: "Preview screenshot-20.png", exact: true })
				.click();
			await page.getByRole("dialog").waitFor();
			await page.keyboard.press("Escape");
			await strip
				.getByRole("button", { name: "Remove screenshot-20.png", exact: true })
				.focus();
			assert(
				await strip
					.getByRole("button", {
						name: "Remove screenshot-20.png",
						exact: true,
					})
					.isVisible(),
			);
			await strip.evaluate((n) => (n.scrollLeft = 0));
		}
	}
	passed.push(
		"20 attachments stay within both narrow panes, compact scrolling reaches the last image and opens it",
	);
	await electron.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].setSize(1240, 880),
	);
	await codex.click();
	await pause();
	await page.screenshot({ path: `${out}/attachments.png` });
	for (const input of [codex, claude]) {
		await input.fill("");
		await input.pressSequentially("attachemnt ");
		assert.equal(await input.inputValue(), "attachment ");
		await input.fill("");
		await input.pressSequentially("fix teh ");
		assert.equal(await input.inputValue(), "fix the ");
		await input.press("Backspace");
		assert.equal(await input.inputValue(), "fix teh");
		await input.press("Space");
		assert.equal(await input.inputValue(), "fix teh ");
		await input.fill("");
		await input.pressSequentially("becuase ");
		assert.equal(await input.inputValue(), "because ");
		await input.press("Control+z");
		assert.equal(await input.inputValue(), "becuase");
		await input.fill("");
		await input.pressSequentially("path C:\\teh ");
		assert.equal(await input.inputValue(), "path C:\\teh ");
		await input.fill("");
		await input.pressSequentially("`teh ");
		assert.equal(await input.inputValue(), "`teh ");
		await input.fill("");
		await input.pressSequentially("/teh ");
		assert.equal(await input.inputValue(), "/teh ");
		await input.fill("");
		await page.keyboard.insertText("pasted teh becuase ");
		assert.equal(await input.inputValue(), "pasted teh becuase ");
		await input.fill("");
		await page.keyboard.insertText("pasted teh");
		await input.press("Space");
		assert.equal(await input.inputValue(), "pasted teh ");
		await input.fill("");
		await input.pressSequentially("hello ");
		await input.press("Control+z");
		assert(
			(await input.inputValue()) !== "hello ",
			"Ordinary editing still has undo",
		);
	}
	passed.push(
		"Both real composers correct typing, preserve native undo, and leave paste/code/paths/commands alone",
	);
	await page.evaluate(() =>
		window.layoutFixture.preferences.getState().setAutocorrect(false),
	);
	await codex.fill("");
	await codex.pressSequentially("teh ");
	assert.equal(await codex.inputValue(), "teh ");
	await page.reload();
	await page.locator("#codex textarea:not([aria-hidden])").waitFor();
	assert.equal(
		await page.evaluate(
			() => window.layoutFixture.preferences.getState().autocorrect,
		),
		false,
	);
	await page.evaluate(() =>
		window.layoutFixture.preferences.getState().setAutocorrect(true),
	);
	passed.push("Autocorrect setting survives a reload");
	await verifyTabMerging({ page, electron, out });
	passed.push(
		"Floating tabs merge via real pointer drags at all four edges, including expanded targets and grouped tabs; Escape cancels cleanly (100%/150% zoom)",
	);
	await electron.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].setSize(1240, 880),
	);
	await pause();
	await page.screenshot({ path: `${out}/workspace.png` });
	assert.deepEqual(errors, []);
	await writeFile(
		`${out}/receipt.json`,
		JSON.stringify({ passed, errors }, null, 2),
	);
	console.log(JSON.stringify({ passed, errors, out }, null, 2));
} catch (error) {
	await page.screenshot({ path: `${out}/failure.png` });
	console.error({ errors });
	throw error;
} finally {
	await electron.close();
}
