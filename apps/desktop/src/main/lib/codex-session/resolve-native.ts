import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** npm's JS launcher does not hide the console of its native child on Windows. */
export function resolveNativeCodex(entry: string, arch = process.arch) {
	const root = dirname(dirname(realpathSync(entry)));
	const triple =
		arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
	const vendors = [join(root, "vendor")];
	try {
		vendors.unshift(
			join(
				dirname(
					createRequire(entry).resolve(
						`@openai/codex-win32-${arch}/package.json`,
					),
				),
				"vendor",
			),
		);
	} catch {
		/* Older CLI releases bundled vendor directly. */
	}
	for (const vendor of vendors) {
		for (const folder of ["bin", "codex"]) {
			const command = join(vendor, triple, folder, "codex.exe");
			if (existsSync(command))
				return { command, args: [] as string[], env: {} };
		}
	}
	throw new Error(
		"The Codex CLI's native Windows executable is missing. Reinstall the Codex CLI to reconnect.",
	);
}
