/** Verify downloaded public artifacts before publishing their draft release. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REQUIRED_MARKERS } from "./personal-bundle";

const { values } = parseArgs({
	options: {
		version: { type: "string" },
		arch: { type: "string" },
		directory: { type: "string" },
		metadata: { type: "string" },
		receipt: { type: "string" },
	},
});
assert.ok(values.version && /^\d+\.\d+\.\d+$/.test(values.version));
assert.ok(values.arch === "x64" || values.arch === "arm64");
assert.ok(values.directory && values.metadata && values.receipt);
const { version, arch } = values;
const root = resolve(import.meta.dir, "../..");
const desktopRequire = createRequire(join(root, "apps/desktop/package.json"));
const builderRequire = createRequire(
	desktopRequire.resolve("electron-builder"),
);
const dependencies = createRequire(builderRequire.resolve("app-builder-lib"));
const seven = (dependencies("7zip-bin") as { path7za: string }).path7za;
const directory = resolve(values.directory);
const name = `GatedSpace-${version}-${arch}.exe`;
const installer = join(directory, name);
const inspection = join(directory, `inspect-${arch}-${Date.now()}`);
mkdirSync(inspection, { recursive: true });
for (const [label, args] of [
	["integrity", ["t", installer]],
	[
		"extract",
		[
			"x",
			installer,
			`-o${inspection}`,
			"-ir!resources/app.asar",
			"-ir!GatedSpace.exe",
			"-ir!resources/resources/git/cmd/git.exe",
			"-ir!resources/resources/git/gatedspace-git.json",
			"-ir!resources/resources/git/LICENSE.txt",
			`-ir!resources/app.asar.unpacked/node_modules/@libsql/win32-${arch}-msvc/index.node`,
			`-ir!resources/app.asar.unpacked/node_modules/@parcel/watcher-win32-${arch}/watcher.node`,
			`-ir!resources/app.asar.unpacked/node_modules/@duckdb/node-bindings-win32-${arch}/duckdb.node`,
			"-y",
		],
	],
] as const) {
	const result = spawnSync(seven, [...args], {
		encoding: "utf8",
		windowsHide: true,
		maxBuffer: 8 * 1024 * 1024,
	});
	writeFileSync(
		join(inspection, `${label}.log`),
		`${result.stdout ?? ""}${result.stderr ?? ""}`,
	);
	assert.equal(result.status, 0, `${arch} ${label} failed`);
}
const asar = dependencies("@electron/asar") as {
	extractFile: (archive: string, file: string) => Buffer;
	listPackage: (archive: string) => string[];
};
const archive = join(inspection, "resources/app.asar");
const read = (name: string) => asar.extractFile(archive, normalize(name));
assert.equal(JSON.parse(read("package.json").toString()).version, version);
const entries = asar
	.listPackage(archive)
	.map((name) => name.replace(/^[/\\]+/, "").replaceAll("\\", "/"));
const compiled = entries.filter(
	(name) => name.startsWith("dist/") && /\.(js|css)$/.test(name),
);
const sources = new Map(compiled.map((name) => [name, read(name).toString()]));
const all = [...sources.values()].join("\n");
const markers = [
	...REQUIRED_MARKERS.filter(
		(marker) =>
			!/^(GATEDSPACE_PERSONAL|NEXT_PUBLIC_RELEASE_BUILD|NEXT_PUBLIC_LOCAL_ONLY):/.test(
				marker,
			),
	),
	"Your space to build",
	"Connect your agents",
	"Open project folder (sets up local history)",
	"https://chatgpt.com/codex/install.ps1",
	"https://claude.ai/install.ps1",
	"--no-gpg-sign",
];
for (const marker of markers)
	assert.ok(all.includes(marker), `Missing public feature: ${marker}`);
for (const scope of ["main", "renderer"]) {
	const text = [...sources]
		.filter(([name]) =>
			scope === "main"
				? name === "dist/main/index.js"
				: name.startsWith("dist/renderer/") && name.endsWith(".js"),
		)
		.map(([, text]) => text)
		.join("\n");
	for (const key of scope === "main"
		? ["NEXT_PUBLIC_LOCAL_ONLY", "NEXT_PUBLIC_RELEASE_BUILD"]
		: ["NEXT_PUBLIC_LOCAL_ONLY"]) {
		const bindings = [
			...text.matchAll(new RegExp(`${key}:\\s*("[^"\\r\\n]*")`, "g")),
		].map((match) => JSON.parse(match[1]));
		assert.ok(
			bindings.length && bindings.every((value) => value === "1"),
			`${scope} ${key} is not public`,
		);
	}
	assert.ok(
		!text.includes('GATEDSPACE_PERSONAL: "1"'),
		"Personal mode in public installer",
	);
}
function verifyPE(file: string) {
	const bytes = readFileSync(file),
		offset = bytes.readUInt32LE(0x3c);
	assert.equal(bytes.readUInt16LE(0), 0x5a4d);
	assert.equal(bytes.readUInt32LE(offset), 0x4550);
	assert.equal(
		bytes.readUInt16LE(offset + 4),
		arch === "x64" ? 0x8664 : 0xaa64,
		`Wrong architecture: ${file}`,
	);
}
verifyPE(join(inspection, "GatedSpace.exe"));
verifyPE(join(inspection, "resources/resources/git/cmd/git.exe"));
const gitPin = JSON.parse(
	readFileSync(
		join(inspection, "resources/resources/git/gatedspace-git.json"),
		"utf8",
	),
);
assert.equal(gitPin.arch, arch);
assert.equal(gitPin.version, "2.56.0.2");
assert.ok(
	statSync(join(inspection, "resources/resources/git/LICENSE.txt")).size > 0,
);
for (const native of [
	`@libsql/win32-${arch}-msvc/index.node`,
	`@parcel/watcher-win32-${arch}/watcher.node`,
	`@duckdb/node-bindings-win32-${arch}/duckdb.node`,
])
	verifyPE(
		join(inspection, "resources/app.asar.unpacked/node_modules", native),
	);
async function hash(
	file: string,
	algorithm = "sha256",
	encoding: "hex" | "base64" = "hex",
) {
	const digest = createHash(algorithm);
	for await (const chunk of createReadStream(file)) digest.update(chunk);
	return digest.digest(encoding);
}
const yaml = dependencies("js-yaml") as {
	load: (input: string) => {
		version: string;
		files: { url: string; sha512: string; size: number }[];
	};
};
const manifest = yaml.load(readFileSync(join(directory, "latest.yml"), "utf8"));
assert.equal(manifest.version, version);
for (const cpu of ["x64", "arm64"])
	assert.ok(
		manifest.files.some(
			(file) => file.url === `GatedSpace-${version}-${cpu}.exe`,
		),
	);
const asset = manifest.files.find((file) => file.url === name);
const sha256 = await hash(installer),
	sha512 = await hash(installer, "sha512", "base64"),
	size = statSync(installer).size;
assert.equal(asset?.size, size);
assert.equal(asset?.sha512, sha512);
const metadata = JSON.parse(readFileSync(values.metadata, "utf8")) as {
	tag_name: string;
	assets: { name: string; digest: string; size: number }[];
};
assert.equal(metadata.tag_name, `desktop-v${version}`);
for (const file of [name, `GatedSpace-${arch}.exe`]) {
	const remote = metadata.assets.find((asset) => asset.name === file);
	assert.equal(remote?.digest, `sha256:${sha256}`);
	assert.equal(remote?.size, size);
}
const blockmap = metadata.assets.find(
	(asset) => asset.name === `${name}.blockmap`,
);
assert.equal(blockmap?.digest, `sha256:${await hash(`${installer}.blockmap`)}`);
const report = {
	ok: true,
	version,
	arch,
	size,
	sha256,
	sha512,
	compiledFiles: compiled.length,
	featureMarkers: markers.length,
	publicBindings: true,
	nativeArchitectures: true,
	privateGit: gitPin.version,
	manifestAndGitHubDigests: true,
};
writeFileSync(values.receipt, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
