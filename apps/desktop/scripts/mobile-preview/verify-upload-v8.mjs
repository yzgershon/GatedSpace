import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Bun's tests use JavaScriptCore, while installed Electron uses V8. Exercise the
// real bundled schema in Node so large-image regexp stack failures cannot hide.
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = join(root, ".tmp/mobile-contract-v8");
mkdirSync(output, { recursive: true });
const bundle = join(output, "contract.cjs");
execFileSync(
	"bun",
	[
		"build",
		"apps/desktop/src/main/lib/mobile-bridge/session-contract.ts",
		"--target=node",
		"--format=cjs",
		"--outfile",
		bundle,
	],
	{ cwd: root, stdio: "pipe" },
);
const { promptSchema } = createRequire(import.meta.url)(bundle);
const requestId = crypto.randomUUID();
const image = (size) => ({
	name: "camera.png",
	mediaType: "image/png",
	data: Buffer.alloc(size, 1).toString("base64"),
});
const started = performance.now();
for (const size of [
	201 * 1024,
	1024 * 1024,
	4 * 1024 * 1024,
	5 * 1024 * 1024,
]) {
	assert(promptSchema.safeParse({ requestId, images: [image(size)] }).success);
	console.log(`PASS V8 accepts ${size} image bytes`);
}
assert(
	!promptSchema.safeParse({ requestId, images: [image(5 * 1024 * 1024 + 1)] })
		.success,
);
assert(
	promptSchema.safeParse({
		requestId,
		images: Array.from({ length: 20 }, () => image(100)),
	}).success,
);
assert(
	!promptSchema.safeParse({
		requestId,
		images: Array.from({ length: 21 }, () => image(100)),
	}).success,
);
for (const data of [
	"a===",
	"a",
	"AA=A",
	"@@@@",
	"AAAA\n",
	"data:image/png;base64,AAAA",
]) {
	assert(
		!promptSchema.safeParse({
			requestId,
			images: [{ mediaType: "image/png", data }],
		}).success,
	);
}
writeFileSync(
	join(output, "results.json"),
	JSON.stringify(
		{
			ok: true,
			engine: process.versions.v8,
			durationMs: performance.now() - started,
			maxImageBytes: 5 * 1024 * 1024,
			maxImages: 20,
			installerBuilt: false,
		},
		null,
		2,
	),
);
console.log(
	"PASS V8 rejects oversized/malformed images and enforces 20-image limit",
);
