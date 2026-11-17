import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const root = resolve(
	import.meta.dir,
	"../../../../.tmp/chrome-launch-verification",
);
await mkdir(resolve(root, "workspace/preview"), { recursive: true });
process.env.SUPERSET_HOME_DIR = resolve(root, "profile");
const { openInChrome, chromeUrl } = await import(
	"../../src/main/lib/browser/open-in-chrome"
);
const { localPreviews } = await import(
	"../../src/main/lib/browser/local-previews"
);
const observed: {
	kind: string;
	path: string;
	hash: string;
	chrome: boolean;
}[] = [];
const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	if (url.pathname === "/done") {
		observed.push({
			kind: url.searchParams.get("kind") ?? "",
			path: url.searchParams.get("path") ?? "",
			hash: url.searchParams.get("hash") ?? "",
			chrome:
				/Chrome\//.test(req.headers["user-agent"] ?? "") &&
				!/Electron\//.test(req.headers["user-agent"] ?? ""),
		});
		res.writeHead(204).end();
	} else {
		res.setHeader("Content-Type", "text/html");
		res.end(
			`<title>Chrome handoff verified</title><style>body{background:#282a36;color:#f8f8f2;font:16px system-ui;padding:48px}</style><h2>GatedSpace → Chrome</h2><p>The website handoff works. You can close this test tab.</p><script>fetch('/done?kind=website')</script>`,
		);
	}
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string")
	throw new Error("Missing verification address");
const origin = `http://127.0.0.1:${address.port}`;
await writeFile(
	resolve(root, "workspace/preview/index.html"),
	`<title>Saved preview handoff verified</title><link rel="stylesheet" href="/style.css"><h2>GatedSpace → Chrome</h2><p>The saved preview, its assets and its route work in Chrome. You can close this test tab.</p><script src="/app.js"></script>`,
);
await writeFile(
	resolve(root, "workspace/preview/style.css"),
	"body{background:#282a36;color:#f8f8f2;font:16px system-ui;padding:48px}",
);
await writeFile(
	resolve(root, "workspace/preview/app.js"),
	`fetch('${origin}/done?kind=saved&path='+encodeURIComponent(location.pathname)+'&hash='+encodeURIComponent(location.hash),{mode:'no-cors'})`,
);
const saved = await localPreviews().capture(
	resolve(root, "workspace/preview"),
	resolve(root, "workspace"),
);
await assert.rejects(
	chromeUrl("file:///C:/Windows/win.ini", { openUrl: async () => "" }),
);
await assert.rejects(
	chromeUrl("javascript:alert(1)", { openUrl: async () => "" }),
);
try {
	await openInChrome(`${origin}/website`);
	await openInChrome(`${saved.url}review?source=sidebar#verified`);
	const start = Date.now();
	while (observed.length < 2 && Date.now() - start < 20_000)
		await new Promise((done) => setTimeout(done, 200));
	assert.ok(
		observed.find((result) => result.kind === "website" && result.chrome),
	);
	assert.ok(
		observed.find(
			(result) =>
				result.kind === "saved" &&
				result.chrome &&
				result.path === "/review" &&
				result.hash === "#verified",
		),
	);
	await writeFile(
		resolve(root, "results.json"),
		JSON.stringify(
			{ ok: true, actualChrome: true, installedGatedSpace: false, observed },
			null,
			2,
		),
	);
	console.log(JSON.stringify({ ok: true, observed }));
} finally {
	server.closeAllConnections();
	server.close();
}
