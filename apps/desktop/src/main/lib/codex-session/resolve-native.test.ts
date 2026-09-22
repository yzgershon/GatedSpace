import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNativeCodex } from "./resolve-native";

test("Windows npm installations run the native binary without a JS console-launching child", () => {
	const root = mkdtempSync(join(tmpdir(), "gatedspace-codex-resolver-"));
	try {
		const pkg = join(root, "node_modules/@openai/codex");
		const platform = join(pkg, "node_modules/@openai/codex-win32-arm64");
		mkdirSync(join(pkg, "bin"), { recursive: true });
		const entry = join(pkg, "bin/codex.js");
		writeFileSync(entry, "");
		mkdirSync(join(platform, "vendor/aarch64-pc-windows-msvc/bin"), {
			recursive: true,
		});
		writeFileSync(
			join(platform, "package.json"),
			'{"name":"@openai/codex-win32-arm64"}',
		);
		const executable = join(
			platform,
			"vendor/aarch64-pc-windows-msvc/bin/codex.exe",
		);
		writeFileSync(executable, "");
		expect(resolveNativeCodex(entry, "arm64")).toEqual({
			command: executable,
			args: [],
			env: {},
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
