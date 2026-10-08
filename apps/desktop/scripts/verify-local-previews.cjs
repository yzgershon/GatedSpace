// Run with Bun. Uses two hidden, isolated Electron processes; never the running app.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function electronStage(root, stage) {
	const { app, BrowserWindow, protocol, session } = require("electron");
	app.setPath("userData", path.join(root, "profile"));
	protocol.registerSchemesAsPrivileged([
		{
			scheme: "gatedspace-preview",
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
			},
		},
	]);
	const timeout = setTimeout(() => app.exit(2), 25_000);
	try {
		await app.whenReady();
		const { LocalPreviewStore } = require(path.join(root, "store.cjs"));
		const store = new LocalPreviewStore(path.join(root, "saved"));
		const partition = "persist:preview-regression";
		session
			.fromPartition(partition)
			.protocol.handle("gatedspace-preview", (request) =>
				store.respond(request),
			);
		let url;
		if (stage === "capture") {
			const workspace = path.join(root, "workspace");
			url = (
				await store.capture(
					path.join(workspace, "output"),
					workspace,
					"http://127.0.0.1:43210/?revision=6#tabs",
				)
			).url;
			await fs.writeFile(path.join(root, "url.txt"), url);
		} else {
			url = await fs.readFile(path.join(root, "url.txt"), "utf8");
			assert.equal(
				await store.resolveUrl("http://127.0.0.1:43210/?revision=6#tabs"),
				url,
			);
		}
		const window = new BrowserWindow({
			show: false,
			webPreferences: {
				webviewTag: true,
				contextIsolation: true,
				sandbox: true,
			},
		});
		const attached = new Promise((resolve) =>
			window.webContents.once("did-attach-webview", (_event, guest) =>
				resolve(guest),
			),
		);
		await window.loadURL("data:text/html,<html><body></body></html>");
		await window.webContents.executeJavaScript(`
			const view = document.createElement('webview');
			view.setAttribute('partition', '${partition}');
			view.setAttribute('src', 'about:blank');
			document.body.appendChild(view);
		`);
		const guest = await attached;
		guest.on("console-message", (event) => console.log(event.message));
		await guest.loadURL(url);
		const check = async () => {
			const result = await guest.executeJavaScript(`(async () => {
				if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', () => resolve(), {once: true}));
				const button = document.querySelector('button');
				button.click();
				return {
					count: button.textContent,
					color: getComputedStyle(button).color,
					data: await (await fetch('/data.json')).json(),
					node: typeof require,
					search: location.search,
					hash: location.hash
				};
			})()`);
			assert.deepEqual(result, {
				count: "1",
				color: "rgb(10, 20, 30)",
				data: { saved: true },
				node: "undefined",
				search: "?revision=6",
				hash: "#tabs",
			});
		};
		await check();
		const reloaded = new Promise((resolve, reject) => {
			guest.once("did-finish-load", resolve);
			guest.once("did-fail-load", (_event, code, message) =>
				reject(new Error(`${code}: ${message}`)),
			);
		});
		guest.reload();
		await reloaded;
		await check();
		await fs.writeFile(
			path.join(root, `${stage}.json`),
			JSON.stringify({
				ok: true,
				stage,
				refresh: true,
				webview: true,
				interactive: true,
			}),
		);
		clearTimeout(timeout);
		window.destroy();
		app.exit(0);
	} catch (error) {
		await fs.writeFile(
			path.join(root, `${stage}.error.txt`),
			String(error.stack ?? error),
		);
		app.exit(1);
	}
}

async function main() {
	const { spawnSync } = require("node:child_process");
	const base = path.resolve(__dirname, "../../../.tmp");
	await fs.mkdir(base, { recursive: true });
	const root = await fs.mkdtemp(path.join(base, "preview-electron-"));
	const output = path.join(root, "workspace", "output");
	await fs.mkdir(output, { recursive: true });
	await fs.writeFile(
		path.join(output, "index.html"),
		'<link rel="stylesheet" href="/style.css"><button>0</button><script src="/app.js"></script>',
	);
	await fs.writeFile(
		path.join(output, "style.css"),
		"button { color: rgb(10, 20, 30) }",
	);
	await fs.writeFile(
		path.join(output, "app.js"),
		"document.querySelector('button').onclick=e=>e.target.textContent=Number(e.target.textContent)+1",
	);
	await fs.writeFile(path.join(output, "data.json"), '{"saved":true}');
	const compiled = spawnSync(
		process.execPath,
		[
			"build",
			path.resolve(__dirname, "../src/main/lib/browser/local-preview-store.ts"),
			"--target=node",
			"--format=cjs",
			`--outfile=${path.join(root, "store.cjs")}`,
		],
		{ encoding: "utf8", windowsHide: true },
	);
	assert.equal(compiled.status, 0, compiled.stderr);
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	delete env.NoDefaultCurrentDirectoryInExePath;
	const electron = require("electron");
	for (const stage of ["capture", "restart"]) {
		if (stage === "restart") {
			assert.ok(
				path.resolve(output).startsWith(`${path.resolve(root)}${path.sep}`),
			);
			await fs.rm(output, { recursive: true });
		}
		const result = spawnSync(electron, [__filename, root, stage], {
			env,
			windowsHide: true,
			encoding: "utf8",
			timeout: 35_000,
		});
		await fs.writeFile(
			path.join(root, `${stage}.log`),
			`${result.stdout ?? ""}\n${result.stderr ?? ""}`,
		);
		assert.equal(result.status, 0, `Electron ${stage} failed; inspect ${root}`);
		assert.equal(
			JSON.parse(await fs.readFile(path.join(root, `${stage}.json`), "utf8"))
				.ok,
			true,
		);
	}
	console.log(
		`PASS: interactive webview, styles, fetch, refresh and full restart without source files. Evidence: ${root}`,
	);
}

if (process.versions.electron) {
	void electronStage(process.argv[2], process.argv[3]);
} else {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
