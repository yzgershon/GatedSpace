import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const FLOW_MODEL = "ggml-base.en-q5_1.bin";
export const FLOW_MODEL_SHA256 =
	"4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f";
export function bundleFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? bundleFiles(path) : [path];
		})
		.sort();
}
export function sha256(path: string) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export function verifyFlowBundle(directory: string, arch: string) {
	if (arch !== "arm64" && arch !== "x64")
		throw new Error(`Unsupported Flow architecture: ${arch}`);
	const manifest = JSON.parse(
		readFileSync(join(directory, "bundle.json"), "utf8"),
	) as { arch: string; files: Record<string, string> };
	if (manifest.arch !== arch)
		throw new Error("Flow bundle architecture mismatch");
	for (const file of [
		"GatedSpace.Flow.exe",
		"GatedSpace.Flow.dll",
		"coreclr.dll",
		"hostfxr.dll",
		"hostpolicy.dll",
		"msvcp140.dll",
		"vcruntime140.dll",
		"vcomp140.dll",
		FLOW_MODEL,
		"LICENSE",
		"THIRD-PARTY-NOTICES.md",
		`runtimes/win-${arch}/whisper.dll`,
		...(arch === "x64"
			? ["vcruntime140_1.dll", "runtimes/noavx/win-x64/whisper.dll"]
			: []),
	])
		if (!manifest.files[file])
			throw new Error(`Missing bundled dictation dependency: ${file}`);
	if (manifest.files[FLOW_MODEL] !== FLOW_MODEL_SHA256)
		throw new Error("Unexpected speech model");
	for (const file of bundleFiles(directory)) {
		const name = relative(directory, file).replaceAll("\\", "/");
		if (name !== "bundle.json" && sha256(file) !== manifest.files[name])
			throw new Error(`Flow bundle checksum mismatch: ${name}`);
	}
	for (const [name, hash] of Object.entries(manifest.files)) {
		if (name.startsWith("/") || name.includes("..") || name.includes(":"))
			throw new Error("Invalid Flow manifest path");
		if (sha256(join(directory, name)) !== hash)
			throw new Error(`Missing or damaged Flow file: ${name}`);
	}
	for (const name of [
		"GatedSpace.Flow.exe",
		"coreclr.dll",
		"msvcp140.dll",
		"vcomp140.dll",
		`runtimes/win-${arch}/whisper.dll`,
	]) {
		const pe = readFileSync(join(directory, name));
		if (
			pe.readUInt16LE(pe.readUInt32LE(0x3c) + 4) !==
			(arch === "arm64" ? 0xaa64 : 0x8664)
		)
			throw new Error(`Wrong Flow binary architecture: ${name}`);
	}
	return manifest;
}
