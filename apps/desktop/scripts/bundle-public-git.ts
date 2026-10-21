/** Pinned app-private MinGit: no admin installer, system PATH, or user Git config. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const pins = {
	x64: {
		name: "64-bit",
		sha256: "da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be",
	},
	arm64: {
		name: "arm64",
		sha256: "38b33dc6024026e3315cf88ab2cfea65205bbd7bb3a8e824bd21c8ad4fe609a7",
	},
};
const arch = process.env.TARGET_ARCH ?? process.arch;
if (arch !== "x64" && arch !== "arm64")
	throw new Error(`Unsupported Git architecture: ${arch}`);
const pin = pins[arch];
const root = resolve(import.meta.dir, "../dist/resources/git");
const marker = join(root, "gatedspace-git.json");
if (
	existsSync(marker) &&
	JSON.parse(readFileSync(marker, "utf8")).sha256 === pin.sha256 &&
	existsSync(join(root, "cmd/git.exe"))
) {
	console.log(`MinGit ${arch} already verified`);
} else {
	const file = `MinGit-2.56.0.2-${pin.name}.zip`;
	const url = `https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/${file}`;
	const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
	if (!response.ok)
		throw new Error(`MinGit download failed: ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
		throw new Error("MinGit checksum mismatch");
	mkdirSync(root, { recursive: true });
	const archive = resolve(root, "../mingit.zip");
	writeFileSync(archive, bytes);
	const result = Bun.spawnSync(
		[
			join(process.env.SystemRoot ?? "C:/Windows", "System32/tar.exe"),
			"-xf",
			archive,
			"-C",
			root,
		],
		{
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (result.exitCode !== 0 || !existsSync(join(root, "cmd/git.exe")))
		throw new Error("MinGit extraction failed");
	writeFileSync(
		marker,
		JSON.stringify({ version: "2.56.0.2", arch, sha256: pin.sha256, url }),
	);
	writeFileSync(
		join(root, "GATEDSPACE-NOTICE.txt"),
		"Unmodified MinGit from Git for Windows, distributed under the included licenses.\nCorresponding source: https://github.com/git-for-windows/git/tree/v2.56.0.windows.2\nRelease and source archives: https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.2\n",
	);
	console.log(`Verified MinGit ${arch}: ${pin.sha256}`);
}
