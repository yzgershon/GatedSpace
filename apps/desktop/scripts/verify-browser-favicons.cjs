// Native Electron guest + production registry/resolver/icon, isolated from the running app.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function verify(root) {
	const {
		app,
		BrowserWindow,
		ipcMain,
		protocol,
		session,
		webContents,
	} = require("electron");
	app.setPath("userData", path.join(root, "profile"));
	protocol.registerSchemesAsPrivileged([
		{
			scheme: "gatedspace-preview",
			privileges: { standard: true, secure: true, supportFetchAPI: true },
		},
	]);
	const timeout = setTimeout(() => app.exit(2), 90000);
	const results = [];
	try {
		await app.whenReady();
		const { resolvePageFavicon } = require(path.join(root, "page-favicon.cjs"));
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ff79c6"/></svg>';
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
			"base64",
		);
		let authenticatedFetch = false;
		let releaseSlow;
		const server = require("node:http").createServer((req, res) => {
			const url = new URL(req.url, "http://localhost");
			if (url.pathname === "/private.svg") {
				authenticatedFetch =
					req.headers.cookie?.includes("fixture=present") ?? false;
				res
					.writeHead(authenticatedFetch ? 200 : 401, {
						"content-type": "image/svg+xml",
					})
					.end(authenticatedFetch ? svg : "Unauthorized");
			} else if (url.pathname === "/favicon.ico")
				res.writeHead(200, { "content-type": "image/png" }).end(png);
			else if (url.pathname === "/bad")
				res
					.writeHead(200, { "content-type": "text/html" })
					.end("<html>Not an image</html>");
			else if (url.pathname === "/oversized")
				res
					.writeHead(200, {
						"content-type": "image/png",
						"content-length": 600000,
					})
					.end(Buffer.alloc(600000));
			else if (url.pathname === "/slow.svg")
				releaseSlow = () =>
					res.writeHead(200, { "content-type": "image/svg+xml" }).end(svg);
			else {
				res.writeHead(200, {
					"content-type": "text/html",
					"set-cookie": "fixture=present; Path=/",
				});
				res.end(
					`<title>${url.pathname}</title>${url.pathname === "/auth" ? '<base href="/assets/"><link rel="icon" href="/bad"><link rel="shortcut icon" href="../private.svg">' : ""}<h1>Favicon fixture</h1>`,
				);
			}
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const base = `http://127.0.0.1:${server.address().port}`;
		const browserSession = session.fromPartition("persist:superset");
		browserSession.protocol.handle(
			"gatedspace-preview",
			(request) =>
				new Response(
					request.url.endsWith("icon.svg")
						? svg
						: '<title>Saved preview</title><link rel="icon" href="/icon.svg">',
					{
						headers: {
							"content-type": request.url.endsWith("icon.svg")
								? "image/svg+xml"
								: "text/html",
						},
					},
				),
		);
		let guest;
		ipcMain.handle("favicon-test", async (_event, method, input) => {
			console.log("IPC", method, input.pageUrl ?? "");
			if (method === "register")
				guest = webContents.fromId(input.webContentsId);
			if (method === "favicon")
				return {
					faviconUrl: await resolvePageFavicon(
						guest,
						input.pageUrl,
						input.candidates,
					),
				};
			return { success: true };
		});
		const window = new BrowserWindow({
			show: false,
			width: 700,
			height: 500,
			webPreferences: {
				webviewTag: true,
				nodeIntegration: true,
				contextIsolation: false,
				backgroundThrottling: false,
			},
		});
		const wc = window.webContents;
		wc.on("console-message", (_event, level, message) =>
			console.log("renderer", level, message),
		);
		await window.loadFile(path.join(root, "index.html"));
		const run = (expression) => wc.executeJavaScript(expression);
		const waitFor = async (expression) => {
			for (let i = 0; i < 150; i++) {
				if (await run(expression)) return;
				await new Promise((resolve) => setTimeout(resolve, 80));
			}
			console.log("STATE", await run("JSON.stringify(faviconTest.state())"));
			console.log(
				"ICON",
				await run("document.getElementById('icon').innerHTML"),
			);
			throw new Error(`Timed out: ${expression}`);
		};
		await waitFor("!!window.faviconTest");
		await run(`faviconTest.open(${JSON.stringify(`${base}/auth`)})`);
		await waitFor(
			"faviconTest.state().faviconUrl?.startsWith('data:image/svg+xml;base64,') && document.querySelector('#icon img')?.naturalWidth === 32",
		);
		assert.ok(authenticatedFetch);
		results.push(
			"Guest cookies, relative favicon, invalid first candidate and actual tab icon render",
		);
		const beforeReload = await run("faviconTest.state().faviconUrl");
		await run("faviconTest.reload()");
		assert.equal(await run("faviconTest.state().faviconUrl"), beforeReload);
		await waitFor("!faviconTest.state().isLoading");
		results.push("Reload preserves the icon");
		await run(`faviconTest.navigate(${JSON.stringify(`${base}/fallback`)})`);
		await waitFor(
			"faviconTest.state().faviconUrl?.startsWith('data:image/png;base64,') && document.querySelector('#icon img')?.naturalWidth === 1",
		);
		results.push("Chromium-style /favicon.ico fallback");
		const data = `data:image/svg+xml,${encodeURIComponent(svg)}`;
		await guest.executeJavaScript(
			`{ const link = document.createElement('link'); link.rel = 'icon'; link.href = ${JSON.stringify(data)}; document.head.append(link); }`,
		);
		await waitFor(
			"faviconTest.state().faviconUrl?.startsWith('data:image/svg+xml;base64,')",
		);
		results.push("Dynamic data-URL favicon updates");
		const currentUrl = guest.getURL();
		assert.equal(
			await resolvePageFavicon(guest, currentUrl, [`${base}/oversized`]),
			beforeReload,
		);
		results.push("Oversized icon skipped for the next real icon");
		const stale = resolvePageFavicon(guest, currentUrl, [`${base}/slow.svg`]);
		for (let i = 0; i < 100 && !releaseSlow; i++)
			await new Promise((resolve) => setTimeout(resolve, 20));
		assert.ok(releaseSlow);
		await run(`faviconTest.navigate(${JSON.stringify(`${base}/next`)})`);
		await waitFor("faviconTest.state().currentUrl.endsWith('/next')");
		releaseSlow();
		assert.equal(await stale, null);
		results.push("Late icon response cannot overwrite a different page");
		await run(
			'faviconTest.navigate("gatedspace-preview://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/")',
		);
		await waitFor(
			"faviconTest.state().currentUrl.startsWith('gatedspace-preview:') && faviconTest.state().faviconUrl?.startsWith('data:image/svg+xml;base64,')",
		);
		results.push("Saved preview custom-protocol favicon");
		const saved = await run("faviconTest.history.at(-1)");
		await run("faviconTest.registry.destroy('test')");
		await run(
			`faviconTest.open(${JSON.stringify(saved.url)}, ${JSON.stringify(saved)})`,
		);
		assert.equal(await run("faviconTest.state().faviconUrl"), saved.faviconUrl);
		results.push(
			"Persisted icon restored immediately without a network round trip",
		);
		await fs.writeFile(
			path.join(root, "receipt.json"),
			JSON.stringify(
				{ nativeElectron: true, installedApp: false, results },
				null,
				2,
			),
		);
		clearTimeout(timeout);
		window.destroy();
		server.close();
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
	const root = path.resolve(desktop, "../../.tmp/browser-favicons");
	await fs.mkdir(root, { recursive: true });
	for (const [entry, output, target] of [
		["src/main/lib/browser/page-favicon.ts", "page-favicon.cjs", "node"],
		["scripts/browser-favicons/renderer.tsx", "renderer.js", "browser"],
	]) {
		const build = await Bun.build({
			entrypoints: [path.join(desktop, entry)],
			target,
			format: "cjs",
			external: ["electron"],
			plugins: [
				{
					name: "fixture-ipc",
					setup(build) {
						build.onResolve({ filter: /^renderer\/lib\/trpc-client$/ }, () => ({
							path: path.join(desktop, "scripts/browser-favicons/trpc.ts"),
						}));
					},
				},
			],
		});
		assert.ok(build.success, String(build.logs));
		await Bun.write(path.join(root, output), build.outputs[0]);
	}
	await fs.writeFile(
		path.join(root, "index.html"),
		'<!doctype html><html><body><div id="icon"></div><div id="page" style="width:600px;height:300px"></div><script>window.exports={};</script><script src="renderer.js"></script></body></html>',
	);
	const env = { ...process.env };
	for (const key of Object.keys(env))
		if (
			["ELECTRON_RUN_AS_NODE", "NODEFAULTCURRENTDIRECTORYINEXEPATH"].includes(
				key.toUpperCase(),
			)
		)
			delete env[key];
	const result = spawnSync(require("electron"), [__filename, root], {
		env,
		windowsHide: true,
		encoding: "utf8",
		timeout: 100000,
	});
	await fs.writeFile(
		path.join(root, "electron.log"),
		`${result.stdout ?? ""}\n${result.stderr ?? ""}`,
	);
	assert.equal(
		result.status,
		0,
		`Native favicon verification failed; inspect ${root}`,
	);
	console.log(await fs.readFile(path.join(root, "receipt.json"), "utf8"));
}
if (process.versions.electron) void verify(process.argv[2]);
else
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
