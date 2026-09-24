import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectProject, restoreProject } from "./project-files";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0))
		await rm(dir, { recursive: true, force: true });
});
test("project round trip preserves source, omits secrets and generated files, and can sync again", async () => {
	const parent = await mkdtemp(join(tmpdir(), "gatedspace-project-test-"));
	dirs.push(parent);
	const source = join(parent, "Source");
	await mkdir(join(source, "src", "auth"), { recursive: true });
	execFileSync("git", ["init", "--quiet", "--template=", source], {
		windowsHide: true,
	});
	await writeFile(
		join(source, "src", "auth", "index.ts"),
		"export const requiresSignIn = true;",
	);
	await writeFile(join(source, ".gitignore"), "build/\n");
	await writeFile(join(source, ".env"), "FAKE_TEST_SECRET=must-not-transfer");
	await writeFile(join(source, "auth.json"), "fake-credentials");
	await mkdir(join(source, "build"));
	await writeFile(join(source, "build", "artifact"), "ignored");
	const project = await collectProject(source);
	expect(project.files.map((f) => f.path).sort()).toEqual([
		".gitignore",
		"src/auth/index.ts",
	]);
	const restored = await restoreProject(parent, "Restored", project);
	expect(
		await readFile(join(restored, "src", "auth", "index.ts"), "utf8"),
	).toBe("export const requiresSignIn = true;");
	expect((await collectProject(restored)).files).toEqual(project.files);
	await expect(restoreProject(parent, "Restored", project)).rejects.toThrow(
		"already exists",
	);
	await expect(restoreProject(parent, "CON", project)).rejects.toThrow(
		"simple name",
	);
	await expect(restoreProject(parent, "../outside", project)).rejects.toThrow(
		"simple name",
	);
});
test("corrupt checkpoint bytes never overwrite an existing project", async () => {
	const parent = await mkdtemp(join(tmpdir(), "gatedspace-project-test-"));
	dirs.push(parent);
	await expect(
		restoreProject(parent, "Example", {
			name: "Example",
			gitRemote: null,
			gitCommit: null,
			files: [
				{
					path: "main.ts",
					content: Buffer.from("damaged").toString("base64"),
					sha256: "0".repeat(64),
					executable: false,
				},
			],
		}),
	).rejects.toThrow("verification failed");
});
