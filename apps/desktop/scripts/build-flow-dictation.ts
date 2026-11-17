/** Reproducible self-contained Flow engine. Only build machines download anything. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
	bundleFiles,
	FLOW_MODEL,
	FLOW_MODEL_SHA256,
	sha256,
	verifyFlowBundle,
} from "./flow-bundle";

if (process.platform !== "win32") process.exit(0);
const arch = process.env.TARGET_ARCH ?? process.arch;
if (arch !== "arm64" && arch !== "x64")
	throw new Error(`Unsupported Flow architecture ${arch}`);
const desktop = resolve(import.meta.dirname, "..");
const source = join(desktop, "native", "flow-dictation");
const output = join(desktop, "dist", "resources", "flow-dictation");
const cacheRoot = join(
	process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
	"GatedSpaceBuild",
);
const sourceFiles = bundleFiles(source).filter(
	(p) => !/[\\/](?:obj|bin)[\\/]/.test(p),
);
const identity = createHash("sha256");
for (const path of [
	...sourceFiles,
	import.meta.filename,
	join(import.meta.dirname, "flow-bundle.ts"),
])
	identity.update(readFileSync(path));
const fingerprint = identity.digest("hex");
const cache = join(cacheRoot, "flow", `${arch}-${fingerprint}`);
mkdirSync(cache, { recursive: true });

async function download(
	url: string,
	path: string,
	hash: string,
	algorithm: "sha256" | "sha512",
) {
	if (
		existsSync(path) &&
		createHash(algorithm).update(readFileSync(path)).digest("hex") === hash
	)
		return;
	const response = await fetch(url);
	if (!response.ok)
		throw new Error(`Flow dependency download failed: ${response.status}`);
	const data = Buffer.from(await response.arrayBuffer());
	if (createHash(algorithm).update(data).digest("hex") !== hash)
		throw new Error("Flow dependency checksum mismatch");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(`${path}.download`, data);
	renameSync(`${path}.download`, path);
}

if (!existsSync(join(cache, "bundle.json"))) {
	const sdkVersion = "8.0.428";
	const sdkDir = join(cacheRoot, `dotnet-${sdkVersion}`);
	const dotnet = join(sdkDir, "dotnet.exe");
	if (!existsSync(join(sdkDir, "sdk", sdkVersion))) {
		const hash =
			process.arch === "arm64"
				? "909437e6001bdd3b5f9a5a0914f990c165f5687570430442631dea8775ddbf5e6fb3eb7840cbbbaaf00d4830a205d1be68f4e048d4bb534ec5a03ced0f4b83f9"
				: "cce1dc5cfb2c5b73ddd9d3658f6009deb85be3a58dbec44a6dfe3910bb32b044ad2fc6bb28c77aded70c73270a204d207fe790dcb82ffca6c7b42c1335b51c21";
		await download(
			`https://builds.dotnet.microsoft.com/dotnet/Sdk/${sdkVersion}/dotnet-sdk-${sdkVersion}-win-${process.arch}.zip`,
			`${sdkDir}.zip`,
			hash,
			"sha512",
		);
		const quote = (path: string) => `'${path.replaceAll("'", "''")}'`;
		execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`Expand-Archive -LiteralPath ${quote(`${sdkDir}.zip`)} -DestinationPath ${quote(sdkDir)} -Force`,
			],
			{ windowsHide: true, stdio: "inherit" },
		);
	}
	const publish = join(cache, "publish");
	execFileSync(
		dotnet,
		[
			"publish",
			join(source, "FlowDictation.csproj"),
			"-c",
			"Release",
			"-r",
			`win-${arch}`,
			"--self-contained",
			"true",
			"-p:RestoreLockedMode=true",
			"-o",
			publish,
		],
		{
			windowsHide: true,
			stdio: "inherit",
			env: {
				...process.env,
				DOTNET_ROOT: sdkDir,
				DOTNET_CLI_TELEMETRY_OPTOUT: "1",
				DOTNET_NOLOGO: "1",
			},
		},
	);
	// Keep only this architecture's native engines (including x64 no-AVX fallback).
	for (const path of bundleFiles(publish)) {
		const name = relative(publish, path).replaceAll("\\", "/");
		if (
			/\.(?:pdb|xml)$/.test(name) ||
			(name.startsWith("runtimes/") && !name.includes(`win-${arch}/`))
		)
			continue;
		const dest = join(cache, "bundle", name);
		mkdirSync(dirname(dest), { recursive: true });
		cpSync(path, dest);
	}
	const bundle = join(cache, "bundle");
	for (const name of ["LICENSE.txt", "ThirdPartyNotices.txt"])
		cpSync(join(sdkDir, name), join(bundle, `dotnet-${name}`));
	// whisper.cpp imports the VC runtime and OpenMP. Ship Microsoft's app-local
	// redistributables, not copies from System32 or a separate runtime installer.
	const vcHash =
		arch === "arm64"
			? "fc8f37250188509818258582758a3b704810c77b6d25845486d583ea99d9aa1f"
			: "4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5";
	const vcZip = join(cacheRoot, "flow", `vc-14.44.35211-${arch}.zip`);
	await download(
		`https://download.visualstudio.microsoft.com/download/pr/45d3b8dd-bced-4b37-9974-142f748d710c/${vcHash}/Microsoft.VC.14.44.17.14.CRT.Redist.${arch.toUpperCase()}.base.vsix`,
		vcZip,
		vcHash,
		"sha256",
	);
	const vcDir = join(cache, "vc");
	const literal = (path: string) => `'${path.replaceAll("'", "''")}'`;
	execFileSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`Expand-Archive -LiteralPath ${literal(vcZip)} -DestinationPath ${literal(vcDir)} -Force`,
		],
		{ windowsHide: true },
	);
	for (const path of bundleFiles(vcDir)) {
		const name = relative(vcDir, path).replaceAll("\\", "/");
		// Microsoft's ARM64 redist also contains an x64 EH helper for emulated apps.
		// Native ARM64 does not import it; don't place a wrong-arch DLL in our bundle.
		if (arch === "arm64" && name.endsWith("/vcruntime140_1.dll")) continue;
		if (
			new RegExp(
				`/${arch}/Microsoft\\.VC143\\.(CRT|OPENMP)/[^/]+\\.dll$`,
				"i",
			).test(name) &&
			!name.includes("debug_nonredist")
		)
			cpSync(path, join(bundle, basename(path)));
	}
	const model = join(cacheRoot, "flow", FLOW_MODEL);
	await download(
		`https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/${FLOW_MODEL}`,
		model,
		FLOW_MODEL_SHA256,
		"sha256",
	);
	cpSync(model, join(bundle, FLOW_MODEL));
	for (const name of ["LICENSE", "THIRD-PARTY-NOTICES.md"])
		cpSync(join(source, name), join(bundle, name));
	const files = Object.fromEntries(
		bundleFiles(bundle).map((path) => [
			relative(bundle, path).replaceAll("\\", "/"),
			sha256(path),
		]),
	);
	writeFileSync(
		join(bundle, "bundle.json"),
		JSON.stringify({ arch, fingerprint, files }, null, 2),
	);
	verifyFlowBundle(bundle, arch);
	writeFileSync(join(cache, "bundle.json"), "ready");
}
const bundle = join(cache, "bundle");
verifyFlowBundle(bundle, arch);
// Build output is a replaceable resource directory. Do not overlay a different architecture.
const { rmSync } = await import("node:fs");
if (resolve(output) !== resolve(desktop, "dist/resources/flow-dictation"))
	throw new Error("Unexpected Flow output directory");
rmSync(output, { recursive: true, force: true });
cpSync(bundle, output, { recursive: true });
verifyFlowBundle(output, arch);
console.log(
	`Bundled offline Flow dictation (${arch}); no separate install or first-run download.`,
);
