// Run with Bun. Uses an isolated, hidden Electron window, never the running app.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function verify(root) {
	const { app, BrowserWindow, Menu } = require("electron");
	app.setPath("userData", path.join(root, "profile"));
	const timeout = setTimeout(() => app.exit(2), 60_000);
	try {
		await app.whenReady();
		const { enableComposerSpellcheck } = require(
			path.join(root, "spellcheck.cjs"),
		);
		const { attachEditContextMenu } = require(path.join(root, "menu.cjs"));
		const window = new BrowserWindow({
			show: false,
			width: 800,
			height: 500,
			webPreferences: {
				spellcheck: true,
				backgroundThrottling: false,
			},
		});
		const wc = window.webContents;
		for (const event of [
			"spellcheck-dictionary-download-begin",
			"spellcheck-dictionary-download-success",
			"spellcheck-dictionary-download-failure",
			"spellcheck-dictionary-initialized",
		]) {
			wc.session.on(event, (_event, language) => console.log(event, language));
		}
		enableComposerSpellcheck(wc.session);
		assert.ok(wc.session.isSpellCheckerEnabled());
		assert.ok(wc.session.getSpellCheckerLanguages().includes("en-US"));
		let menu;
		let context;
		const originalBuild = Menu.buildFromTemplate;
		Menu.buildFromTemplate = (items) => {
			menu = items;
			return { popup() {} };
		};
		attachEditContextMenu(wc);
		wc.on("context-menu", (_event, params) => {
			context = params;
		});
		await window.loadFile(path.join(root, "index.html"));
		const waitFor = async (expression) => {
			for (let i = 0; i < 150; i++) {
				if (await wc.executeJavaScript(expression)) return;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			throw new Error(`Timed out: ${expression}`);
		};
		await waitFor(
			"document.querySelectorAll('textarea:not([aria-hidden])').length === 2",
		);
		const results = [];
		for (const name of ["Codex", "Claude"]) {
			const selector = `textarea[aria-label="${name}"]`;
			await wc.executeJavaScript(
				`document.querySelector(${JSON.stringify(selector)}).focus()`,
			);
			await wc.insertText("recieve ");
			await waitFor(
				`document.querySelector('#${name}').textContent === 'recieve '`,
			);
			assert.equal(
				await wc.executeJavaScript(
					`document.querySelector(${JSON.stringify(selector)}).spellcheck`,
				),
				true,
			);
			const point = await wc.executeJavaScript(
				`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+22),y:Math.round(r.top+12)}})()`,
			);
			// Exercise the asynchronous native spelling path, rather than
			// webFrame.isWordMisspelled (which only consults Hunspell on Windows).
			for (let attempt = 0; attempt < 40; attempt++) {
				menu = undefined;
				context = undefined;
				wc.sendInputEvent({ type: "mouseDown", button: "right", ...point });
				wc.sendInputEvent({ type: "mouseUp", button: "right", ...point });
				await new Promise((resolve) => setTimeout(resolve, 250));
				if (context?.misspelledWord === "recieve") break;
			}
			console.log(
				name,
				JSON.stringify({
					word: context?.misspelledWord,
					suggestions: context?.dictionarySuggestions,
				}),
			);
			assert.equal(
				context?.misspelledWord,
				"recieve",
				`${name}: native misspelling context`,
			);
			const correction = menu.find((item) => item.label === "receive");
			assert.ok(correction, `${name}: receive suggestion`);
			assert.ok(menu.some((item) => item.label === "Add to Dictionary"));
			correction.click();
			await waitFor(
				`document.querySelector('#${name}').textContent === 'receive '`,
			);
			wc.undo();
			await waitFor(
				`document.querySelector('#${name}').textContent === 'recieve '`,
			);
			results.push(
				`${name}: native suggestion, controlled draft replacement, undo`,
			);
		}
		assert.equal(
			await wc.executeJavaScript(
				"[...document.querySelectorAll('[aria-hidden=true]')].every(e=>!e.spellcheck)",
			),
			true,
		);
		Menu.buildFromTemplate = originalBuild;
		await fs.writeFile(
			path.join(root, "screenshot.png"),
			(await wc.capturePage()).toPNG(),
		);
		await fs.writeFile(
			path.join(root, "receipt.json"),
			JSON.stringify(
				{ ok: true, results, languages: wc.session.getSpellCheckerLanguages() },
				null,
				2,
			),
		);
		clearTimeout(timeout);
		window.destroy();
		app.exit(0);
	} catch (error) {
		await fs.writeFile(
			path.join(root, "error.txt"),
			String(error.stack ?? error),
		);
		app.exit(1);
	}
}

async function main() {
	const { spawnSync } = require("node:child_process");
	const desktop = path.resolve(__dirname, "..");
	const base = path.resolve(desktop, "../../.tmp");
	await fs.mkdir(base, { recursive: true });
	const root = await fs.mkdtemp(path.join(base, "composer-spellcheck-"));
	for (const [source, target] of [
		["spellcheck", "spellcheck"],
		["edit-context-menu", "menu"],
	]) {
		const build = spawnSync(
			process.execPath,
			[
				"build",
				path.join(desktop, `src/main/lib/${source}.ts`),
				"--target=node",
				"--format=cjs",
				"--external=electron",
				`--outfile=${path.join(root, `${target}.cjs`)}`,
			],
			{ encoding: "utf8", windowsHide: true },
		);
		assert.equal(build.status, 0, build.stderr);
	}
	const renderer = `import React,{useState} from ${JSON.stringify(require.resolve("react"))};
import {createRoot} from ${JSON.stringify(require.resolve("react-dom/client"))};
import {GrowingTextarea} from ${JSON.stringify(path.join(desktop, "src/renderer/components/SessionComposerControls/GrowingTextarea.tsx"))};
const h=React.createElement;
function Composer({name}){const [value,setValue]=useState('');return h('section',null,h('h2',null,name),h('div',{className:'session-input'},h(GrowingTextarea,{'aria-label':name,value,onChange:e=>setValue(e.target.value)})),h('output',{id:name},value))}
createRoot(document.getElementById('root')).render(h(React.Fragment,null,h(Composer,{name:'Codex'}),h(Composer,{name:'Claude'})));`;
	await fs.writeFile(path.join(root, "renderer.tsx"), renderer);
	const build = spawnSync(
		process.execPath,
		[
			"build",
			path.join(root, "renderer.tsx"),
			"--target=browser",
			"--define",
			'process.env.NODE_ENV="production"',
			`--outdir=${root}`,
		],
		{ encoding: "utf8", windowsHide: true },
	);
	assert.equal(build.status, 0, build.stderr);
	await fs.writeFile(
		path.join(root, "index.html"),
		'<!doctype html><html lang="en"><link rel="stylesheet" href="renderer.css"><style>body{background:#292a36;color:#eee;font-family:Segoe UI;padding:20px}section{margin-bottom:22px}textarea{font:18px/26px Segoe UI!important}output{white-space:pre}</style><div id="root"></div><script src="renderer.js"></script></html>',
	);
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	delete env.NoDefaultCurrentDirectoryInExePath;
	const result = spawnSync(require("electron"), [__filename, root], {
		env,
		windowsHide: true,
		encoding: "utf8",
		timeout: 70_000,
	});
	await fs.writeFile(
		path.join(root, "electron.log"),
		`${result.stdout ?? ""}\n${result.stderr ?? ""}`,
	);
	assert.equal(result.status, 0, `Electron spellcheck failed; inspect ${root}`);
	console.log(await fs.readFile(path.join(root, "receipt.json"), "utf8"));
	console.log(`Evidence: ${root}`);
}

if (process.versions.electron) void verify(process.argv[2]);
else
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
