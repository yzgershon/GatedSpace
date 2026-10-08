import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { browserUrlKey } from "../../../shared/agent-browser";
import { LocalPreviewStore } from "./local-preview-store";

const fixtures: string[] = [];
const base = resolve(import.meta.dir, "../../../../../../.tmp");
afterEach(async () => {
	for (const folder of fixtures.splice(0)) {
		if (!relative(base, folder).startsWith("local-preview-test-"))
			throw new Error("Unexpected cleanup target");
		await rm(folder, { recursive: true, force: true });
	}
});
async function fixture() {
	await mkdir(base, { recursive: true });
	const root = await mkdtemp(join(base, "local-preview-test-"));
	fixtures.push(root);
	const workspace = join(root, "workspace");
	const output = join(workspace, ".tmp", "example-preview");
	await mkdir(output, { recursive: true });
	await writeFile(
		join(output, "index.html"),
		'<link rel="stylesheet" href="/style.css"><button id="count">0</button><script src="/app.js"></script>',
	);
	await writeFile(
		join(output, "style.css"),
		"button { color: rgb(10, 20, 30) }",
	);
	await writeFile(
		join(output, "app.js"),
		"document.querySelector('button').onclick=e=>e.target.textContent=Number(e.target.textContent)+1",
	);
	await writeFile(join(output, "url.txt"), "http://127.0.0.1:43210");
	return {
		root,
		workspace,
		output,
		storeRoot: join(root, "saved"),
		store: new LocalPreviewStore(join(root, "saved")),
	};
}

test("a stopped preview server and removed build folder do not break a restored interactive preview", async () => {
	const { output, workspace, store, storeRoot } = await fixture();
	const opened = await store.capture(
		output,
		workspace,
		"http://127.0.0.1:43210/?revision=6#tabs",
	);
	expect(browserUrlKey(opened.url)).toBe(opened.url);
	await rm(output, { recursive: true });
	const restarted = new LocalPreviewStore(storeRoot);
	expect(
		await restarted.resolveUrl("http://127.0.0.1:43210/?revision=6#tabs"),
	).toBe(opened.url);
	expect(
		await (await restarted.respond(new Request(opened.url))).text(),
	).toContain('<button id="count">');
	expect(
		await (
			await restarted.respond(new Request(new URL("/app.js", opened.url)))
		).text(),
	).toContain("onclick");
	expect(
		(
			await restarted.respond(new Request(new URL("/style.css", opened.url)))
		).headers.get("content-type"),
	).toContain("text/css");
});

test("legacy saved URL manifests upgrade automatically, including a project beneath the session cwd", async () => {
	const { store, workspace, output } = await fixture();
	// Unrelated scratch files must not exhaust the directory discovery budget.
	await Promise.all(
		Array.from({ length: 210 }, (_, index) =>
			writeFile(
				join(workspace, ".tmp", `000-scratch-${index}.txt`),
				"unrelated",
			),
		),
	);
	const url = await store.resolveUrl("http://127.0.0.1:43210/?revision=6", [
		resolve(workspace, ".."),
	]);
	expect(url).toStartWith("gatedspace-preview://");
	expect(url).toEndWith("/?revision=6");
	expect(await (await store.respond(new Request(url))).text()).toBe(
		await readFile(join(output, "index.html"), "utf8"),
	);
});

test("repeat captures reuse identity; regenerated assets update atomically", async () => {
	const { store, output, workspace } = await fixture();
	const first = await store.capture(output, workspace);
	const same = await store.capture(output, workspace);
	expect(same.url).toBe(first.url);
	expect(same.updated).toBe(false);
	await writeFile(join(output, "app.js"), "document.title='Updated preview'");
	const updated = await store.capture(output, workspace);
	expect(updated.url).toBe(first.url);
	expect(updated.updated).toBe(true);
	expect(
		await (
			await store.respond(new Request(new URL("/app.js", first.url)))
		).text(),
	).toContain("Updated preview");
});

test("invalid captures keep the last working copy", async () => {
	const { store, output, workspace } = await fixture();
	const first = await store.capture(output, workspace);
	await rm(join(output, "index.html"));
	await expect(store.capture(output, workspace)).rejects.toThrow("index.html");
	expect((await store.respond(new Request(first.url))).status).toBe(200);
});

test("external sites and unregistered live servers are not redirected or cached", async () => {
	const { store, workspace, output } = await fixture();
	for (const url of [
		"https://example.com",
		"http://localhost:9999/app",
		"http://192.168.1.2:3000",
	])
		expect(await store.resolveUrl(url, [workspace])).toBe(url);
	await expect(
		store.capture(output, workspace, "https://example.com"),
	).rejects.toThrow("loopback");
	await expect(store.capture(workspace, workspace)).rejects.toThrow(
		"project root",
	);
	await expect(
		store.capture(output, join(workspace, ".tmp", "other")),
	).rejects.toThrow();
});

test("private and unsupported files, traversal, unknown IDs and backend writes are blocked", async () => {
	const { store, output, workspace } = await fixture();
	await writeFile(join(output, ".env.json"), "private");
	await writeFile(join(output, "source.ts"), "private");
	const { url } = await store.capture(output, workspace);
	for (const path of [
		"/.env.json",
		"/source.ts",
		"/%2e%2e%5cmanifest.json",
		"/missing.png",
	])
		expect((await store.respond(new Request(new URL(path, url)))).status).toBe(
			404,
		);
	expect(
		(await store.respond(new Request(url, { method: "POST", body: "no" })))
			.status,
	).toBe(405);
	expect(
		(
			await store.respond(
				new Request("gatedspace-preview://00000000000000000000000000000000/"),
			)
		).status,
	).toBe(404);
	expect(
		(await store.respond(new Request(new URL("/nested/route", url)))).status,
	).toBe(200);
});
