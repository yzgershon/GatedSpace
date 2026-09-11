const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const output = process.env.GS_TERMINAL_TEST_OUTPUT;
if (!output) throw new Error("Run through scripts/test-terminal-rendering.ts");
app.setPath("userData", path.join(output, `user-data-${process.pid}`));
app.on("window-all-closed", () => {});
const results = [];
let current = "startup";
const timeout = setTimeout(
	() => finish(new Error(`Timed out: ${current}`)),
	60000,
);

function finish(error) {
	clearTimeout(timeout);
	const report = { ok: !error, current, results, error: error?.stack };
	fs.writeFileSync(
		path.join(output, "results.json"),
		JSON.stringify(report, null, 2),
	);
	if (error) console.error(error);
	else
		console.log(`PASS: ${results.length} Electron terminal rendering checks`);
	app.exit(error ? 1 : 0);
}

app
	.whenReady()
	.then(async () => {
		const window = new BrowserWindow({
			width: 1400,
			height: 950,
			show: false,
			webPreferences: { backgroundThrottling: false },
		});
		window.webContents.on("console-message", (event) => {
			const details = event;
			console.log(
				`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`,
			);
		});
		await window.loadFile(path.join(output, "index.html"));
		const run = (expression) =>
			window.webContents.executeJavaScript(`terminalSmoke.${expression}`);
		async function check(name, { corners = true, webgl = true } = {}) {
			current = name;
			const state = await run("snapshot()");
			const screenshot = await window.webContents.capturePage();
			fs.writeFileSync(path.join(output, `${name}.png`), screenshot.toPNG());
			assert.deepEqual(
				{ cols: state.cols, rows: state.rows },
				state.proposed,
				`${name}: fit`,
			);
			assert.deepEqual(
				state.reportedSize,
				[state.cols, state.rows],
				`${name}: PTY size notification`,
			);
			if (webgl) {
				assert.ok(
					state.buffer,
					`${name}: expected WebGL, not a silent fallback`,
				);
				assert.deepEqual(
					state.viewport,
					[0, 0, ...state.buffer],
					`${name}: GL viewport differs from backing buffer`,
				);
			} else assert.equal(state.buffer, null, `${name}: expected DOM fallback`);
			const bitmap = screenshot.toBitmap();
			const size = screenshot.getSize();
			const scale = size.width / state.innerWidth;
			if (corners) {
				for (const [index, point] of state.corners.entries()) {
					const x = Math.floor(point.x * scale);
					const y = Math.floor(point.y * scale);
					assert.ok(
						x >= 0 && y >= 0 && x < size.width && y < size.height,
						`${name}: corner ${index} is outside capture`,
					);
					const offset = (y * size.width + x) * 4;
					// NativeImage bitmaps are BGRA. Sentinels use ANSI red backgrounds.
					const [b, g, r] = bitmap.subarray(offset, offset + 3);
					assert.ok(
						r > 100 && r > g * 2 && r > b * 2,
						`${name}: corner ${index} missing (RGB ${r},${g},${b})`,
					);
				}
			} else {
				assert.ok(
					state.firstLine.includes("idle shell prompt"),
					`${name}: prompt never reached xterm`,
				);
				// The idle prompt must be visible before any additional output.
				let bright = 0;
				for (let y = 0; y < Math.ceil(35 * scale); y++) {
					for (let x = 0; x < Math.ceil(400 * scale); x++) {
						const i = (y * size.width + x) * 4;
						if (bitmap[i] > 180 && bitmap[i + 1] > 180 && bitmap[i + 2] > 180)
							bright++;
					}
				}
				assert.ok(
					bright > 30,
					`${name}: prompt buffer exists but screen is blank`,
				);
			}
			results.push({ name, ...state });
		}
		for (const zoom of [0.85, 1, 1.2]) {
			current = `start-${zoom}`;
			await run(`start(${zoom})`);
			await check(`idle-${zoom}`, { corners: false });
			await run("paintCorners()");
			await check(`corners-${zoom}`);
		}
		await run("scale(0.85)");
		await check("scale-change");
		await run("resize()");
		await check("split-resize");
		await run("park()");
		await check("park-and-reattach");
		await run("font()");
		await check("font-change");
		await run("alternate()");
		await check("alternate-screen");
		await run("repaintPreservesStyle()");
		await check("repaint-preserves-style");
		await run("loseContext(true)");
		await check("context-restored");
		await run("loseContext(false)");
		await run("paintCorners()");
		await check("context-loss-fallback", { webgl: false });
		await run("start(0.85)");
		await check("new-terminal-after-context-loss", { corners: false });
		current = "shared-atlas-invalidation";
		const {
			changedBytes,
			differences,
			referenceImages,
			beforeImages,
			afterImages,
		} = await run("sharedAtlas()");
		console.log("Atlas pixel differences", differences);
		for (let i = 0; i < 2; i++)
			for (const [stage, images] of [
				["before", beforeImages],
				["after", afterImages],
				["reference", referenceImages],
			])
				fs.writeFileSync(
					path.join(output, `atlas-${stage}-${i}.png`),
					Buffer.from(images[i].split(",")[1], "base64"),
				);
		assert.deepEqual(
			changedBytes,
			[0, 0],
			"Refreshing one terminal must not corrupt either sibling's glyphs",
		);
		results.push({ name: current, changedBytes });
		finish();
	})
	.catch(finish);
