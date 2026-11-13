// Run verify-workspace-polish.mjs first to bundle the production composers.
// Uses a separate hidden Electron window and profile. Provider IPC is simulated.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const desktop = resolve(import.meta.dirname, "..");
const req = createRequire(resolve(desktop, "package.json"));
const root = resolve(desktop, "../../.tmp/attachments-20261112/native");
const fixture = resolve(
	desktop,
	"../../.tmp/workspace-polish-verification/index.html",
);
await readFile(fixture);
await mkdir(root, { recursive: true });
const store = resolve(desktop, "../../node_modules/.bun");
const pkg = (await readdir(store)).find((name) =>
	name.startsWith("playwright@"),
);
const { _electron } = await import(
	pathToFileURL(resolve(store, pkg, "node_modules/playwright/index.mjs"))
);
await writeFile(
	resolve(root, "preload.cjs"),
	`const {contextBridge,webUtils}=require('electron');contextBridge.exposeInMainWorld('webUtils',{getPathForFile:file=>webUtils.getPathForFile(file)});`,
);
await writeFile(
	resolve(root, "main.cjs"),
	`const {app,BrowserWindow}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:1200,height:1100,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});window.loadFile(${JSON.stringify(fixture)});});`,
);
const files = [
	["Reading notes.pdf", "%PDF-1.7\n", 600_000],
	["Essay draft.docx", "PK", 900_000],
	["Budget.xlsx", "PK", 400_000],
	["Project archive.zip", "PK", 8_000_000],
	["large-source.ts", "// source\n", 800_000],
];
const paths = [];
for (const [name, prefix, size] of files) {
	const path = resolve(root, name);
	await writeFile(
		path,
		Buffer.concat([Buffer.from(prefix), Buffer.alloc(size)]),
	);
	paths.push(path);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electron = await _electron.launch({
	executablePath: req("electron"),
	args: [resolve(root, "main.cjs")],
	env,
});
const passed = [],
	errors = [];
try {
	const page = await electron.firstWindow();
	page.on("pageerror", (error) => errors.push(error.message));
	page.setDefaultTimeout(12000);
	const notes = page.getByRole("button", { name: "Back to my workspace" });
	await page.locator("#codex").waitFor();
	if (await notes.isVisible()) {
		await notes.click();
		await page.getByRole("dialog").waitFor({ state: "detached" });
	}
	const png = await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 400;
		canvas.getContext("2d").fillRect(0, 0, 400, 400);
		return canvas.toDataURL("image/png").split(",")[1];
	});
	const imagePath = resolve(root, "Screenshot 600KB.png");
	await writeFile(
		imagePath,
		Buffer.concat([Buffer.from(png, "base64"), Buffer.alloc(600_000)]),
	);
	for (const provider of ["codex", "claude"]) {
		const composer = page.locator(`#${provider} .session-composer`);
		const input = page.locator(`#${provider} textarea:not([aria-hidden])`);
		await input.fill("Review these files:");
		// Keep the hidden test from opening a foreground Windows dialog. Verify
		// the real + button activates its file input, then supply native disk files.
		const fileInput = page.locator(`#${provider} input[type=file]`);
		await fileInput.evaluate((element) => {
			element.addEventListener("click", (event) => {
				event.preventDefault();
				element.dataset.pickerActivated = "true";
			});
		});
		await page
			.locator(`#${provider}`)
			.getByRole("button", { name: /^Attach (files|a file)$/ })
			.click();
		assert.equal(await fileInput.getAttribute("data-picker-activated"), "true");
		await fileInput.setInputFiles([...paths, imagePath]);
		await page.waitForFunction(
			({ provider, paths }) => {
				const text = document.querySelector(
					`#${provider} textarea:not([aria-hidden])`,
				).value;
				return (
					paths.every((path) => text.includes(path)) &&
					document.querySelectorAll(`#${provider} .session-image-tile`)
						.length === 1
				);
			},
			{ provider, paths },
		);
		assert.equal(await composer.getAttribute("aria-busy"), "false");
		passed.push(
			`${provider}: + activates file input; native Windows PDF/DOCX/XLSX/ZIP/source paths and a 600KB image attach`,
		);
		await page.evaluate(() => {
			const source = document.createElement("input");
			source.type = "file";
			source.multiple = true;
			source.id = "native-drag-source";
			source.hidden = true;
			document.body.append(source);
		});
		await page
			.locator("#native-drag-source")
			.setInputFiles([...paths, imagePath]);
		const nativePaths = await page.evaluate(() =>
			Array.from(document.querySelector("#native-drag-source").files).map(
				(file) => window.webUtils.getPathForFile(file),
			),
		);
		assert.deepEqual(nativePaths, [...paths, imagePath]);
		await input.fill("Dropped files:");
		await input.evaluate((element) => {
			const dataTransfer = new DataTransfer();
			for (const file of document.querySelector("#native-drag-source").files)
				dataTransfer.items.add(file);
			for (const type of ["dragenter", "dragover"])
				element.dispatchEvent(
					new DragEvent(type, {
						dataTransfer,
						bubbles: true,
						cancelable: true,
					}),
				);
		});
		await page.getByText("Drop files to attach", { exact: true }).waitFor();
		await input.evaluate((element) => {
			const dataTransfer = new DataTransfer();
			for (const file of document.querySelector("#native-drag-source").files)
				dataTransfer.items.add(file);
			element.dispatchEvent(
				new DragEvent("drop", {
					dataTransfer,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await page.waitForFunction(
			({ provider, paths }) => {
				const text = document.querySelector(
					`#${provider} textarea:not([aria-hidden])`,
				).value;
				return (
					paths.every((path) => text.includes(path)) &&
					document.querySelectorAll(`#${provider} .session-image-tile`)
						.length === 2 &&
					document
						.querySelector(`#${provider} .session-composer`)
						.getAttribute("aria-busy") === "false"
				);
			},
			{ provider, paths },
		);
		assert.equal(await composer.getAttribute("data-dragging"), "false");
		await page.locator("#native-drag-source").evaluate((el) => el.remove());
		passed.push(
			`${provider}: mixed file drop retains native paths, attaches image, clears drop feedback, and never submits`,
		);
	}
	assert.deepEqual(await page.evaluate(() => window.polishFixture.sent), []);
	assert.deepEqual(errors, []);
	await page.screenshot({
		path: resolve(root, "verified.png"),
		fullPage: true,
	});
	const result = {
		passed,
		errors,
		nativeElectron: true,
		providerIPC: "simulated",
		physicalExplorerDrag: "not exercised",
		nativePickerDialog: "suppressed; file input supplied by automation",
	};
	await writeFile(
		resolve(root, "results.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result, null, 2));
} finally {
	await electron.close();
}
