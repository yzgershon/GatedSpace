/** Isolated, hidden Electron fixture. Never sends desktop input or opens user pages. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow } from "electron";
import {
	clickBrowserPoint,
	pressBrowserKey,
} from "../src/main/lib/browser/agent-browser-input";
import { browserSnapshotScript } from "../src/main/lib/browser/agent-browser-snapshot";
import { applyBrowserPreview } from "../src/main/lib/browser/browser-preview";
import type { BrowserPreviewMode } from "../src/shared/browser-preview";

const output = resolve(process.cwd(), ".tmp/browser-background-input");
app.setPath("userData", resolve(output, "profile"));
void (async () => {
	await mkdir(output, { recursive: true });
	await app.whenReady();
	app.on("window-all-closed", () => {});
	const window = new BrowserWindow({
		show: false,
		width: 900,
		height: 700,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	const wc = window.webContents;
	await wc.loadURL(
		`data:text/html,${encodeURIComponent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button{position:absolute;left:110px;top:130px;width:120px;height:60px}input{position:absolute;left:30px;top:30px}</style><input id="entry" aria-label="Entry"><button id="target" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Click target</button>')}`,
	);
	const checks: string[] = [];
	for (const mode of [
		"responsive",
		"desktop",
		"galaxy-s24",
	] as BrowserPreviewMode[]) {
		applyBrowserPreview(wc, { mode, orientation: "portrait", scale: 0.55 });
		wc.setZoomFactor(mode === "responsive" ? 1.25 : 1);
		await delay(150);
		assert.equal(window.isFocused(), false);
		const before = await wc.executeJavaScript(
			"Number(document.getElementById('target').dataset.clicks||0)",
		);
		const point = await wc.executeJavaScript(
			"(() => {const r=document.getElementById('target').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
		);
		await clickBrowserPoint(wc, point);
		assert.equal(
			await wc.executeJavaScript(
				"Number(document.getElementById('target').dataset.clicks)",
			),
			before + 1,
			`${mode}: click must hit once`,
		);
		await wc.executeJavaScript(
			"document.getElementById('entry').value='';document.getElementById('entry').focus()",
		);
		await pressBrowserKey(wc, "x");
		assert.equal(
			await wc.executeJavaScript("document.getElementById('entry').value"),
			"x",
		);
		await pressBrowserKey(wc, "Backspace");
		assert.equal(
			await wc.executeJavaScript("document.getElementById('entry').value"),
			"",
		);
		await pressBrowserKey(wc, "Tab");
		await pressBrowserKey(wc, "Enter");
		assert.equal(
			await wc.executeJavaScript(
				"Number(document.getElementById('target').dataset.clicks)",
			),
			before + 2,
		);
		const snapshot = await wc.executeJavaScriptInIsolatedWorld(1005, [
			{ code: browserSnapshotScript() },
		]);
		assert.equal(snapshot.elements.length, 2);
		assert.equal(window.isVisible(), false);
		assert.equal(window.isFocused(), false);
		checks.push(
			`${mode}: unfocused click, typing, deletion, Tab/Enter and isolated snapshot`,
		);
	}
	window.destroy();
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify({ ok: true, checks }, null, 2),
	);
	console.log(JSON.stringify({ ok: true, checks }));
	app.exit(0);
})().catch((error) => {
	console.error(error);
	app.exit(1);
});
