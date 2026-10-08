import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildJobSchema } from "../../apps/desktop/src/shared/build-status";
import {
	compareBundles,
	readCompiledBundle,
	validatePersonalBundle,
} from "./personal-bundle";

function assertArm64(data: Buffer, name: string) {
	assert.equal(data.readUInt16LE(0), 0x5a4d, `Invalid executable: ${name}`);
	const header = data.readUInt32LE(0x3c);
	assert.equal(data.readUInt32LE(header), 0x4550, `Invalid PE header: ${name}`);
	assert.equal(
		data.readUInt16LE(header + 4),
		0xaa64,
		`Expected ARM64: ${name}`,
	);
}

async function hash(
	file: string,
	algorithm = "sha256",
	encoding: "hex" | "base64" = "hex",
) {
	const digest = createHash(algorithm);
	for await (const chunk of createReadStream(file)) digest.update(chunk);
	return digest.digest(encoding);
}

async function main() {
	const { values } = parseArgs({
		options: {
			repo: { type: "string" },
			job: { type: "string" },
			receipt: { type: "string" },
			preflight: { type: "boolean" },
			"personal-only": { type: "boolean" },
		},
	});
	if (
		values["personal-only"] &&
		values.preflight &&
		process.env.GATEDSPACE_PERSONAL !== "1"
	) {
		console.log("Personal bundle contract skipped for a non-personal build.");
		return;
	}
	const repo = resolve(values.repo ?? join(import.meta.dir, "../.."));
	const compiled = readCompiledBundle(repo);
	const checked = validatePersonalBundle(compiled);
	if (values.preflight) {
		console.log(
			JSON.stringify({ ok: true, phase: "compiled-preflight", ...checked }),
		);
		return;
	}
	assert.ok(
		values.job && values.receipt,
		"Expected --job and --receipt (or --preflight).",
	);
	const job = buildJobSchema.parse(
		JSON.parse(readFileSync(values.job, "utf8").replace(/^\uFEFF/, "")),
	);
	assert.equal(job.channel, "personal");
	assert.deepEqual(job.architectures, ["arm64"]);
	const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: repo,
		encoding: "utf8",
	}).trim();
	assert.equal(
		sourceCommit,
		job.sourceCommit,
		"Snapshot commit differs from job",
	);
	assert.equal(
		execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
			cwd: repo,
			encoding: "utf8",
		}).trim(),
		"",
		"Snapshot has tracked changes",
	);
	const desktop = join(repo, "apps/desktop");
	const sourcePackage = JSON.parse(
		readFileSync(join(desktop, "package.json"), "utf8"),
	);
	assert.equal(sourcePackage.version, job.version);
	const desktopRequire = createRequire(join(desktop, "package.json"));
	const builderRequire = createRequire(
		desktopRequire.resolve("electron-builder"),
	);
	const dependencies = createRequire(builderRequire.resolve("app-builder-lib"));
	const installer = join(
		desktop,
		"release",
		`GatedSpace-personal-${job.version}-arm64.exe`,
	);
	const inspection = join(
		repo,
		".tmp",
		`personal-${job.version}-arm64-inspect`,
	);
	const seven = (dependencies("7zip-bin") as { path7za: string }).path7za;
	mkdirSync(dirname(resolve(values.receipt)), { recursive: true });
	for (const [phase, args] of [
		["integrity", ["t", installer]],
		[
			"extract",
			[
				"x",
				installer,
				`-o${inspection}`,
				"-ir!resources/app.asar",
				"-ir!GatedSpace.exe",
				"-ir!resources/app.asar.unpacked/*",
				"-y",
			],
		],
	] as const) {
		const result = spawnSync(seven, [...args], {
			encoding: "utf8",
			windowsHide: true,
			timeout: 300_000,
		});
		const log: string = `${values.receipt}.${phase}.log`;
		writeFileSync(log, `${result.stdout ?? ""}${result.stderr ?? ""}`);
		assert.equal(result.status, 0, `Installer ${phase} failed; see ${log}`);
	}
	const asar = dependencies("@electron/asar") as {
		extractFile: (file: string, name: string) => Buffer;
		listPackage: (file: string) => string[];
	};
	const archive = join(inspection, "resources/app.asar");
	const read = (name: string) => asar.extractFile(archive, normalize(name));
	const packagedPackage = JSON.parse(read("package.json").toString());
	assert.equal(packagedPackage.version, job.version);
	assert.equal(packagedPackage.productName, "GatedSpace");
	const entries = asar
		.listPackage(archive)
		.map((name) => name.replace(/^[/\\]+/, "").replaceAll("\\", "/"));
	const packaged = new Map(
		entries
			.filter(
				(name) => name.startsWith("dist/") && /\.(js|css|html)$/.test(name),
			)
			.map((name) => [name, read(name)]),
	);
	compareBundles(compiled, packaged);
	validatePersonalBundle(packaged);
	assert.equal(
		entries.filter((name) => name.startsWith("dist/") && name.endsWith(".map"))
			.length,
		0,
		"Packaged sourcemaps remain",
	);
	assertArm64(
		readFileSync(join(inspection, "GatedSpace.exe")),
		"GatedSpace.exe",
	);
	const nativeFiles = [
		"@libsql/win32-arm64-msvc/index.node",
		"@parcel/watcher-win32-arm64/watcher.node",
		"node-pty/prebuilds/win32-arm64/conpty.node",
		"node-pty/prebuilds/win32-arm64/conpty_console_list.node",
		"node-pty/prebuilds/win32-arm64/pty.node",
		"@duckdb/node-bindings-win32-arm64/duckdb.node",
	];
	for (const name of nativeFiles) {
		const expected = readFileSync(join(desktop, "node_modules", name));
		const actual = readFileSync(
			join(`${archive}.unpacked`, "node_modules", name),
		);
		assert.ok(actual.equals(expected), `Native binary differs: ${name}`);
		assertArm64(actual, name);
	}
	assert.equal(
		basename(installer),
		`GatedSpace-personal-${job.version}-arm64.exe`,
	);
	assert.ok(
		statSync(`${installer}.blockmap`).size > 0,
		"Missing installer blockmap",
	);
	const yaml = dependencies("js-yaml") as { load: (source: string) => unknown };
	const manifest = yaml.load(
		readFileSync(join(dirname(installer), "latest.yml"), "utf8"),
	) as {
		version: string;
		files: Array<{ url: string; sha512: string; size: number }>;
	};
	assert.equal(manifest.version, job.version);
	const item = manifest.files.find((file) => file.url === basename(installer));
	assert.ok(item, "Installer missing from update manifest");
	const sha512 = await hash(installer, "sha512", "base64");
	const size = statSync(installer).size;
	assert.equal(item.sha512, sha512, "Installer checksum differs from manifest");
	assert.equal(item.size, size, "Installer size differs from manifest");
	const receipt = {
		ok: true,
		version: job.version,
		sourceCommit,
		architecture: "arm64",
		...checked,
		matchedNativeFiles: nativeFiles,
		asarSha256: await hash(archive),
		sha256: await hash(installer),
		sha512,
		size,
		manifestMatches: true,
		path: installer,
	};
	writeFileSync(values.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(JSON.stringify(receipt));
}

main().catch((error) => {
	console.error(
		error instanceof Error
			? error.message
			: "Personal installer verification failed",
	);
	process.exitCode = 1;
});
