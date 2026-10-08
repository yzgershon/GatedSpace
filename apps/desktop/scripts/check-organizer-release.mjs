import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2];
const desktop = join(repo, "apps/desktop");
const output = join(repo, ".tmp/session-organizer-preview");
const build = spawnSync(
	"bun",
	["scripts/preview-session-organizer.ts", "--build-only"],
	{ cwd: desktop, stdio: "inherit", windowsHide: true },
);
assert.equal(build.status, 0, "Organizer fixture compilation failed");
const assets = join(desktop, "dist/renderer/assets");
const styles = readdirSync(assets)
	.filter((f) => f.endsWith(".css") && !f.startsWith("computer-overlay-"))
	.map((f) => readFileSync(join(assets, f), "utf8"))
	.join("\n");
assert.ok(
	styles.includes("session-organizer"),
	"Organizer styles missing from release",
);
writeFileSync(
	join(output, "style.css"),
	styles +
		"\n" +
		readFileSync(join(desktop, "scripts/organizer-preview/style.css"), "utf8"),
);
const { createServer } = await import("node:net");
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const url = `http://127.0.0.1:${port}`;
// A dedicated fixture port and disposable metadata keep checks off the live profile.
let occupied = false;
try {
	await fetch(url, { signal: AbortSignal.timeout(700) });
	occupied = true;
} catch {}
assert.equal(occupied, false, "Organizer fixture port is already occupied");
const child = spawn(
	"bun",
	["scripts/preview-session-organizer.ts", "--skip-build", "--checks"],
	{
		cwd: desktop,
		stdio: "inherit",
		windowsHide: true,
		env: { ...process.env, ORGANIZER_PREVIEW_PORT: String(port) },
	},
);
try {
	let ready = false;
	for (let i = 0; i < 100; i++) {
		if (child.exitCode !== null)
			throw new Error("Organizer fixture exited before readiness");
		try {
			ready = (await fetch(url, { signal: AbortSignal.timeout(500) })).ok;
		} catch {}
		if (ready) break;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	assert.ok(ready, "Organizer fixture did not start");
	const check = spawnSync(
		process.execPath,
		["scripts/check-session-organizer.mjs"],
		{
			cwd: desktop,
			stdio: "inherit",
			windowsHide: true,
			env: { ...process.env, ORGANIZER_PREVIEW_URL: url },
		},
	);
	assert.equal(
		check.status,
		0,
		"Organizer compiled-style interaction checks failed",
	);
	const result = JSON.parse(readFileSync(join(output, "checks.json"), "utf8"));
	assert.equal(result.errors.length, 0);
	assert.equal(result.checks.length, 13);
	writeFileSync(
		join(output, "results.json"),
		JSON.stringify({ ...result, ok: true, packagedStyles: true }, null, 2),
	);
} finally {
	child.kill();
}
