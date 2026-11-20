import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	COMPUTER_UV_VERSION,
	ensureComputerRunner,
	publishRuntimeDirectory,
	verifyRuntimeArchive,
} from "./runtime";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture(arch = "x64") {
	const root = mkdtempSync(join(tmpdir(), "gs-computer-setup-"));
	roots.push(root);
	let requested = "";
	const options = {
		root,
		arch,
		platform: "win32",
		find: () => undefined,
		download: async (url: string) => {
			requested = url;
			return Buffer.from("untrusted archive");
		},
	};
	return { root, options, requested: () => requested };
}
test("an existing user runtime needs no download or environment changes", async () => {
	const { options, requested } = fixture();
	const path = process.env.PATH;
	expect(
		await ensureComputerRunner(new AbortController().signal, undefined, {
			...options,
			find: () => "existing-uvx.exe",
		}),
	).toBe("existing-uvx.exe");
	expect(requested()).toBe("");
	expect(process.env.PATH).toBe(path);
});
for (const [arch, target] of [
	["x64", "x86_64"],
	["arm64", "aarch64"],
]) {
	test(
		arch +
			" downloads only its pinned official archive and rejects changed bytes",
		async () => {
			const { options, requested } = fixture(arch);
			let extracted = false;
			await expect(
				ensureComputerRunner(new AbortController().signal, undefined, {
					...options,
					run: async () => {
						extracted = true;
						return { stdout: "", stderr: "" };
					},
				}),
			).rejects.toThrow("could not be verified");
			expect(requested()).toBe(
				`https://github.com/astral-sh/uv/releases/download/${COMPUTER_UV_VERSION}/uv-${target}-pc-windows-msvc.zip`,
			);
			expect(extracted).toBe(false);
		},
	);
}
test("completed private runtime works on a later launch with no network", async () => {
	const { options, root, requested } = fixture();
	const dir = join(root, `uv-${COMPUTER_UV_VERSION}-x64`);
	mkdirSync(dir);
	for (const name of ["uv.exe", "uvx.exe"])
		writeFileSync(join(dir, name), "MZfixture");
	expect(
		await ensureComputerRunner(
			new AbortController().signal,
			undefined,
			options,
		),
	).toBe(join(dir, "uvx.exe"));
	expect(requested()).toBe("");
});
test("stop before setup makes no download", async () => {
	const { options, requested } = fixture();
	const controller = new AbortController();
	controller.abort();
	await expect(
		ensureComputerRunner(controller.signal, undefined, options),
	).rejects.toThrow();
	expect(requested()).toBe("");
});

test("a partial private install can be repaired without changing user binaries", async () => {
	const { root } = fixture();
	const destination = join(root, `uv-${COMPUTER_UV_VERSION}-x64`);
	const staging = join(root, ".setup-fixture");
	const unpacked = join(staging, "unpacked");
	mkdirSync(destination);
	writeFileSync(join(destination, "uvx.exe"), "truncated");
	mkdirSync(unpacked, { recursive: true });
	for (const name of ["uv.exe", "uvx.exe"])
		writeFileSync(join(unpacked, name), "MZnew");
	await publishRuntimeDirectory(unpacked, destination);
	expect(readFileSync(join(destination, "uvx.exe"), "utf8")).toBe("MZnew");
	expect(existsSync(join(staging, "incomplete", "uvx.exe"))).toBe(true);
});

test("incomplete extraction cannot replace an installed runtime", async () => {
	const { root } = fixture();
	const destination = join(root, "installed");
	const unpacked = join(root, "unpacked");
	mkdirSync(destination);
	mkdirSync(unpacked);
	for (const name of ["uv.exe", "uvx.exe"])
		writeFileSync(join(destination, name), "MZexisting");
	writeFileSync(join(unpacked, "uvx.exe"), "MZpartial");
	await expect(publishRuntimeDirectory(unpacked, destination)).rejects.toThrow(
		"incomplete",
	);
	expect(readFileSync(join(destination, "uvx.exe"), "utf8")).toBe("MZexisting");
});
test("stop during download cannot install or publish an executable", async () => {
	const { options } = fixture();
	const controller = new AbortController();
	await expect(
		ensureComputerRunner(controller.signal, undefined, {
			...options,
			download: async () => {
				controller.abort();
				return Buffer.from("cancelled");
			},
		}),
	).rejects.toThrow();
});
test("archive integrity is checked on bytes, not a claimed download filename", () => {
	const bytes = Buffer.from("fixture");
	verifyRuntimeArchive(bytes, createHash("sha256").update(bytes).digest("hex"));
	expect(() =>
		verifyRuntimeArchive(
			Buffer.from("changed"),
			createHash("sha256").update(bytes).digest("hex"),
		),
	).toThrow();
});
