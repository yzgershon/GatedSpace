// Isolated hidden Electron window. Does not attach to or restart the installed app.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function verify(root) {
	const { app, BrowserWindow, nativeImage } = require("electron");
	app.setPath("userData", path.join(root, "profile"));
	const timeout = setTimeout(() => app.exit(2), 30000);
	try {
		await app.whenReady();
		const { captureTabThumbnail } = require(path.join(root, "capture.cjs"));
		const win = new BrowserWindow({
			show: false,
			width: 1000,
			height: 700,
			webPreferences: { backgroundThrottling: false },
		});
		await win.loadURL(
			`data:text/html,${encodeURIComponent('<body style="margin:0;background:red"><div id="pane" style="position:absolute;left:100px;top:100px;width:500px;height:300px;background:rgb(40,42,54)"><h1 style="color:white">Actual Electron capture</h1></div></body>')}`,
		);
		for (const zoom of [1, 1.25]) {
			win.webContents.setZoomFactor(zoom);
			await win.webContents.executeJavaScript(
				"new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
			);
			const rect = await win.webContents.executeJavaScript(
				'JSON.parse(JSON.stringify(document.getElementById("pane").getBoundingClientRect()))',
			);
			const data = await captureTabThumbnail(win, rect);
			assert.ok(data.startsWith("data:image/jpeg;base64,"));
			const image = nativeImage.createFromDataURL(data);
			const size = image.getSize();
			assert.ok(size.width <= 688 && size.height <= 320);
			assert.ok(Math.abs(size.width / size.height - 5 / 3) < 0.02);
			const bitmap = image.toBitmap();
			assert.ok(
				Math.abs(bitmap[0] - 54) < 8 && Math.abs(bitmap[2] - 40) < 8,
				"Crop starts in the pane, not the red window background",
			);
			await fs.writeFile(
				path.join(root, `capture-${zoom}.jpg`),
				image.toJPEG(90),
			);
		}
		win.destroy();
		assert.equal(
			await captureTabThumbnail(win, { x: 0, y: 0, width: 10, height: 10 }),
			null,
		);
		assert.equal(
			await captureTabThumbnail(null, { x: 0, y: 0, width: 10, height: 10 }),
			null,
		);
		await fs.writeFile(
			path.join(root, "receipt.json"),
			JSON.stringify(
				{
					ok: true,
					checks: [
						"Actual Electron capture at 100% and 125% page zoom",
						"Correct crop, bounded JPEG, preserved aspect",
						"Closed/missing window handled",
					],
					installedAppTouched: false,
				},
				null,
				2,
			),
		);
		clearTimeout(timeout);
		app.quit();
	} catch (error) {
		await fs.writeFile(
			path.join(root, "error.txt"),
			String(error.stack ?? error),
		);
		app.exit(1);
	}
}
async function main() {
	const root = path.resolve(__dirname, "../../../.tmp/tab-thumbnail-native");
	await fs.mkdir(root, { recursive: true });
	const result = await Bun.build({
		entrypoints: [path.resolve(__dirname, "../src/main/lib/tab-thumbnail.ts")],
		target: "node",
		format: "cjs",
		external: ["electron"],
	});
	assert.ok(result.success, String(result.logs));
	await Bun.write(path.join(root, "capture.cjs"), result.outputs[0]);
	const env = { ...process.env };
	for (const key of Object.keys(env))
		if (
			["ELECTRON_RUN_AS_NODE", "NODEFAULTCURRENTDIRECTORYINEXEPATH"].includes(
				key.toUpperCase(),
			)
		)
			delete env[key];
	const child = require("node:child_process").spawnSync(
		require("electron"),
		[__filename, root],
		{ env, windowsHide: true, encoding: "utf8", timeout: 40000 },
	);
	await fs.writeFile(
		path.join(root, "electron.log"),
		`${child.stdout ?? ""}\n${child.stderr ?? ""}`,
	);
	assert.equal(child.status, 0, `See ${root}/error.txt`);
	console.log(await fs.readFile(path.join(root, "receipt.json"), "utf8"));
}
if (process.versions.electron) void verify(process.argv[2]);
else
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
