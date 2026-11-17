import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { LocalPreviewStore } from "./local-preview-store";
import { PreviewBrowserBridge } from "./preview-browser-bridge";

const base = resolve(import.meta.dir, "../../../../../../.tmp");
const fixtures: { root: string; bridge: PreviewBrowserBridge }[] = [];
afterEach(async () => {
	for (const { root, bridge } of fixtures.splice(0)) {
		await bridge.close();
		if (!relative(base, root).startsWith("chrome-preview-test-"))
			throw new Error("Unexpected cleanup target");
		await rm(root, { recursive: true, force: true });
	}
});

test("Chrome preview keeps routes/assets and isolates captured output behind browser authorization", async () => {
	await mkdir(base, { recursive: true });
	const root = await mkdtemp(join(base, "chrome-preview-test-"));
	const output = join(root, "project", "preview");
	await mkdir(output, { recursive: true });
	await writeFile(
		join(output, "index.html"),
		'<script src="/app.js"></script><h1>Preview</h1>',
	);
	await writeFile(join(output, "app.js"), "window.previewWorks=true;");
	await writeFile(join(output, ".secret"), "never served");
	const store = new LocalPreviewStore(join(root, "saved"));
	const bridge = new PreviewBrowserBridge(store);
	fixtures.push({ root, bridge });
	const captured = await store.capture(output, join(root, "project"));
	await expect(
		bridge.openUrl(`${captured.url}/unrelated.test/`),
	).rejects.toThrow("Invalid preview path");
	const external = await bridge.openUrl(
		`${captured.url}accounts?view=all#review`,
	);
	expect(new URL(external).hostname).toBe("127.0.0.1");
	expect(new URL(external).hash).toBe("#review");
	const start = await fetch(external, { redirect: "manual" });
	expect(start.status).toBe(303);
	expect(start.headers.get("location")).toBe("/accounts?view=all");
	expect(start.headers.get("set-cookie")).toContain(
		"HttpOnly; SameSite=Strict",
	);
	const cookie = start.headers.get("set-cookie")?.split(";")[0] ?? "";
	const origin = new URL(external).origin;
	expect((await fetch(origin)).status).toBe(403);
	expect((await fetch(external, { redirect: "manual" })).status).toBe(403);
	const headers = { Cookie: cookie };
	expect(
		await (await fetch(`${origin}/accounts?view=all`, { headers })).text(),
	).toContain("<h1>Preview</h1>");
	expect(await (await fetch(`${origin}/app.js`, { headers })).text()).toBe(
		"window.previewWorks=true;",
	);
	expect((await fetch(`${origin}/.secret`, { headers })).status).toBe(404);
	expect((await fetch(`${origin}/manifest.json`, { headers })).status).toBe(
		404,
	);
	expect(
		(
			await fetch(origin, {
				headers: { ...headers, Origin: "https://unrelated.test" },
			})
		).status,
	).toBe(403);
	expect((await fetch(origin, { method: "POST", headers })).status).toBe(405);
	const another = await bridge.openUrl(captured.url);
	expect(new URL(another).origin).toBe(origin);
	expect((await fetch(another, { redirect: "manual" })).status).toBe(303);
});
