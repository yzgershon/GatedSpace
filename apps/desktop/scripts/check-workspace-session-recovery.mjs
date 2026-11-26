/** Real renderer auth/bootstrap in Chrome; isolated accounts and a failing fixture API. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);

const desktop = resolve(import.meta.dirname, "..");
const output = resolve(desktop, "../../.tmp/startup-recovery");
await mkdir(output, { recursive: true });
const checks = [];
const errors = [];
let mode = "online";
let name = "Saved workspace user";
let bundle = "";
let authenticatedRequests = 0;
function respond(request) {
	const path = new URL(request.url).pathname;
	if (path === "/fixture.js")
		return new Response(bundle, {
			headers: { "Content-Type": "text/javascript" },
		});
	if (path === "/api/auth/get-session") {
		if (request.headers.get("Authorization") !== "Bearer fixture-session-a")
			return Response.json(null);
		authenticatedRequests++;
		if (mode === "offline")
			return Response.json(
				{ message: "Simulated backend outage" },
				{ status: 503 },
			);
		const date = "2026-11-25T12:00:00.000Z";
		return Response.json({
			user: {
				id: "fixture-user",
				name,
				email: "fixture@example.test",
				emailVerified: true,
				createdAt: date,
				updatedAt: date,
				onboardedAt: date,
				image: `data:image/png;base64,${"A".repeat(310_000)}`,
			},
			session: {
				id: "fixture-session",
				token: "fixture-session-a",
				userId: "fixture-user",
				activeOrganizationId: "original-workspace-org",
				organizationIds: ["original-workspace-org"],
				role: "owner",
				plan: "pro",
				createdAt: date,
				updatedAt: date,
				expiresAt: "2100-01-01T00:00:00.000Z",
				ipAddress: "",
				userAgent: "",
			},
		});
	}
	return new Response(
		'<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
		{ headers: { "Content-Type": "text/html" } },
	);
}
const server = createServer(async (request, response) => {
	const result = respond(
		new Request(`${origin}${request.url}`, { headers: request.headers }),
	);
	response.writeHead(result.status, Object.fromEntries(result.headers));
	response.end(Buffer.from(await result.arrayBuffer()));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const entry = resolve(output, "entry.tsx");
await writeFile(
	entry,
	`
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { authClient, setAuthToken } from ${JSON.stringify(resolve(desktop, "src/renderer/lib/auth-client.ts"))};
import { applyStoredAuthTokenBeforeRender } from ${JSON.stringify(resolve(desktop, "src/renderer/lib/auth-bootstrap.ts"))};
await applyStoredAuthTokenBeforeRender();
function Subscriber() { authClient.useSession(); return null; }
function App() {
  const { data, isPending } = authClient.useSession();
  return createElement("main", { "data-status": data ? "workspace" : isPending ? "pending" : "sign-in", "data-org": data?.session.activeOrganizationId ?? "" }, data?.user.name ?? "", ...Array.from({length: 30}, (_, key) => createElement(Subscriber, {key})));
}
window.recoveryFixture = { refresh: () => authClient.getSession({fetchOptions: {onSuccess: () => authClient.$store.notify("$sessionSignal")}}), logout: async () => { await setAuthToken(null); await authClient.getSession(); authClient.$store.notify("$sessionSignal"); } };
createRoot(document.getElementById("root")).render(createElement(App));
`,
);

async function compileFixture({ desktop, entry, origin, bundlePath }) {
	const { resolve } = await import("node:path");
	const build = await Bun.build({
		entrypoints: [entry],
		target: "browser",
		define: { "process.env.NODE_ENV": '"development"' },
		plugins: [
			{
				name: "isolated-local-api-and-ipc",
				setup(builder) {
					builder.onResolve(
						{ filter: /^react(?:-dom\/client)?$/ },
						({ path }) => ({ path: Bun.resolveSync(path, desktop) }),
					);
					builder.onResolve({ filter: /^renderer\/env\.renderer$/ }, () => ({
						path: "env",
						namespace: "fixture",
					}));
					builder.onResolve({ filter: /^renderer\/lib\/trpc-client$/ }, () => ({
						path: "ipc",
						namespace: "fixture",
					}));
					builder.onResolve({ filter: /^renderer\// }, ({ path }) => ({
						path: resolve(desktop, `src/${path}.ts`),
					}));
					builder.onLoad(
						{ filter: /.*/, namespace: "fixture" },
						({ path }) => ({
							loader: "js",
							contents:
								path === "env"
									? `export const env = { NEXT_PUBLIC_API_URL: ${JSON.stringify(origin)}, NEXT_PUBLIC_LOCAL_ONLY: "0" };`
									: 'export const electronTrpcClient = {auth: {getStoredToken: {query: async () => ({token: localStorage.getItem("fixture-token"), expiresAt: "2100-01-01T00:00:00.000Z"})}}};',
						}),
					);
				},
			},
		],
	});
	if (!build.success) throw new Error(build.logs.join("\n"));
	await Bun.write(bundlePath, await build.outputs[0].text());
}
const bundlePath = resolve(output, "fixture.js");
const compiled = spawnSync(
	"bun",
	[
		"-e",
		`(${compileFixture.toString()})(${JSON.stringify({ desktop, entry, origin, bundlePath })})`,
	],
	{ cwd: desktop, encoding: "utf8", windowsHide: true },
);
assert.equal(compiled.status, 0, compiled.stderr);
bundle = await readFile(bundlePath, "utf8");
console.log("Renderer fixture compiled");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage();
	page.setDefaultTimeout(10_000);
	page.on("pageerror", (error) => {
		errors.push(error.message);
		console.error(error.message);
	});
	console.log("Checking online startup");
	await page.goto(origin);
	await page.evaluate(() =>
		localStorage.setItem("fixture-token", "fixture-session-a"),
	);
	await page.reload();
	await page.locator('main[data-status="workspace"]').waitFor();
	await page.waitForFunction(() =>
		Object.keys(localStorage).some((key) =>
			key.startsWith("gatedspace:workspace-session:"),
		),
	);
	assert.equal(
		await page.locator("main").getAttribute("data-org"),
		"original-workspace-org",
	);
	assert.ok(authenticatedRequests > 0);
	checks.push("actual bearer authentication and original workspace identity");
	const encoded = await page.evaluate(() =>
		localStorage.getItem(
			Object.keys(localStorage).find((key) =>
				key.startsWith("gatedspace:workspace-session:"),
			),
		),
	);
	assert.ok(
		encoded &&
			encoded.length < 2_000 &&
			!encoded.includes("fixture-session-a") &&
			!encoded.includes("data:image"),
	);
	checks.push(
		"large avatar and raw credential excluded from persisted identity",
	);
	console.log("Checking cached startup during outage");
	mode = "offline";
	await page.reload({ waitUntil: "domcontentloaded" });
	await page
		.locator('main[data-status="workspace"][data-org="original-workspace-org"]')
		.waitFor({ timeout: 2_000 });
	await page.waitForTimeout(1_000);
	assert.equal(
		await page.locator("main").getAttribute("data-status"),
		"workspace",
	);
	checks.push(
		"cold launch and failed background refresh retain saved workspace",
	);
	console.log("Checking recovery and account boundaries");
	mode = "online";
	name = "Refreshed workspace user";
	await page.evaluate(() => window.recoveryFixture.refresh());
	await page.getByText(name, { exact: true }).waitFor();
	checks.push("live session replaces saved identity after recovery");
	mode = "offline";
	await page.evaluate(() =>
		localStorage.setItem("fixture-token", "fixture-session-b"),
	);
	await page.reload();
	await page
		.locator('main[data-status="sign-in"]')
		.waitFor({ state: "attached" });
	checks.push("other credential cannot open previous saved workspace");
	mode = "online";
	await page.evaluate(() =>
		localStorage.setItem("fixture-token", "fixture-session-a"),
	);
	await page.reload();
	await page.locator('main[data-status="workspace"]').waitFor();
	await page.evaluate(() => window.recoveryFixture.logout());
	await page
		.locator('main[data-status="sign-in"]')
		.waitFor({ state: "attached" });
	assert.equal(
		await page.evaluate(() =>
			Object.keys(localStorage).some((key) =>
				key.startsWith("gatedspace:workspace-session:"),
			),
		),
		false,
	);
	checks.push("sign-out clears restored identity");
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "browser-receipt.json"),
		JSON.stringify({ passed: true, checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ passed: true, checks }));
} finally {
	await browser.close();
	server.closeAllConnections();
	server.close();
}
