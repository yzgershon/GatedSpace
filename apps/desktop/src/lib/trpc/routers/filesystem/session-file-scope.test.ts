import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createFsHostService,
	FsWatcherManager,
} from "@superset/workspace-fs/host";
import { sessionFileRoot } from "./session-file-scope";

const root = await mkdtemp(path.join(tmpdir(), "gatedspace-live-read-"));
const folder = path.join(root, "project");
await mkdir(folder);
const file = path.join(folder, "example.ts");
await writeFile(file, "export const alive = true;\n");
afterAll(() => rm(root, { recursive: true, force: true }));

describe("live file session scope", () => {
	test("native directory watcher survives an atomic file replacement", async () => {
		const watched = path.join(folder, "atomic-watch.ts");
		await writeFile(watched, "before");
		const rootPath = await sessionFileRoot(
			{ provider: "codex", key: "pane" },
			folder,
			() => folder,
		);
		const watcher = new FsWatcherManager();
		const service = createFsHostService({ rootPath, watcherManager: watcher });
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let report: () => void = () => {};
		const observed = new Promise<void>((resolve, reject) => {
			report = resolve;
			timeout = setTimeout(
				() => reject(new Error("No atomic-save file event")),
				5000,
			);
		});
		const unsubscribe = await watcher.subscribe(
			{ absolutePath: folder, recursive: false },
			(batch) => {
				if (
					batch.events.some(
						(event) => path.basename(event.absolutePath) === "atomic-watch.ts",
					)
				)
					report();
			},
		);
		try {
			await writeFile(
				path.join(folder, "replacement.tmp"),
				"export const updated = true;\n",
			);
			await rename(path.join(folder, "replacement.tmp"), watched);
			await observed;
			expect(
				(await service.readFile({ absolutePath: watched, encoding: "utf-8" }))
					.content,
			).toContain("updated");
		} finally {
			clearTimeout(timeout);
			await unsubscribe();
			await service.close();
		}
	});
	for (const provider of ["codex", "claude"] as const) {
		test(`${provider} reads its actual folder without a legacy workspace row`, async () => {
			const scope = { provider, key: "pane-with-new-host-workspace-id" };
			const resolved = await sessionFileRoot(scope, file, (received) => {
				expect(received).toEqual(scope);
				return folder;
			});
			const service = createFsHostService({ rootPath: resolved });
			const result = await service.readFile({
				absolutePath: file,
				encoding: "utf-8",
			});
			expect(result.content).toBe("export const alive = true;\n");
			await service.close();
		});
	}
	test("missing sessions fail closed with a reconnect message", async () => {
		await expect(
			sessionFileRoot(
				{ provider: "codex", key: "gone" },
				file,
				() => undefined,
			),
		).rejects.toThrow("reconnecting");
	});
	test("read and watch scope rejects traversal and outside symlink targets", async () => {
		const scope = { provider: "claude" as const, key: "pane" };
		await expect(
			sessionFileRoot(
				scope,
				path.join(folder, "..", "outside.ts"),
				() => folder,
			),
		).rejects.toThrow("outside");
		const outside = path.join(root, "outside");
		await mkdir(outside);
		await writeFile(path.join(outside, "private.ts"), "private");
		await symlink(outside, path.join(folder, "escape"), "junction");
		await expect(
			sessionFileRoot(scope, path.join(folder, "escape"), () => folder),
		).rejects.toThrow("resolves outside");
		await expect(
			sessionFileRoot(
				scope,
				path.join(folder, "escape", "private.ts"),
				() => folder,
			),
		).rejects.toThrow("resolves outside");
	});
});
