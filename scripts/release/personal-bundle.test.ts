import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PERSONAL_BACKEND } from "../../apps/desktop/vite/personal-backend";
import {
	compareBundles,
	REQUIRED_MARKERS,
	validatePersonalBackend,
	validatePersonalBundle,
} from "./personal-bundle";

function fixture(): Map<string, Buffer> {
	const endpoints = Object.entries(PERSONAL_BACKEND)
		.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
		.join(",\n");
	return new Map([
		[
			"dist/main/index.js",
			Buffer.from(
				`${endpoints}\n${REQUIRED_MARKERS.join("\n")}\nGatedSpace control border\nThe desktop control indicator closed.\ncontrol-border\ncontrol-toolbar\nComputer control ready\nReading the screen\n/Windows/i.test(navigator.userAgent) ? "dom" : "webgl"`,
			),
		],
		["dist/renderer/assets/index.js", Buffer.from(endpoints)],
		["dist/main/host-service.js", Buffer.from("host service")],
		["dist/preload/computer-overlay.js", Buffer.from("overlay")],
		["dist/renderer/computer-overlay.html", Buffer.from("control-stop")],
		[
			"dist/renderer/assets/style.css",
			Buffer.from(
				".codex-native { width: 100%; flex: 1 1 0; } .gs-tab-switcher { padding: 8px; }",
			),
		],
	]);
}

test("both processes must use the personal backend, even when all feature checks match", () => {
	for (const name of ["dist/main/index.js", "dist/renderer/assets/index.js"]) {
		const bundle = fixture();
		const original = bundle.get(name);
		if (!original) throw new Error(`Missing fixture: ${name}`);
		bundle.set(
			name,
			Buffer.from(
				original
					.toString()
					.replaceAll("http://localhost:3001", "https://api.superset.sh"),
			),
		);
		expect(() => validatePersonalBundle(bundle)).toThrow(
			"backend: NEXT_PUBLIC_API_URL",
		);
	}
});

test("schema defaults and unrelated local URL strings cannot satisfy endpoint verification", () => {
	const bundle = fixture();
	bundle.set(
		"dist/renderer/assets/index.js",
		Buffer.from(
			'NEXT_PUBLIC_API_URL: z.url().default("http://localhost:3001")',
		),
	);
	expect(() => validatePersonalBackend(bundle)).toThrow(
		"Missing personal renderer binding: NEXT_PUBLIC_API_URL",
	);
});

test("tab release markers match the real component, including the close control typo regression", () => {
	const tab = readFileSync(
		resolve(
			import.meta.dir,
			"../../apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/TabRail/TabRail.tsx",
		),
		"utf8",
	);
	const markers = REQUIRED_MARKERS.filter((marker) =>
		marker.startsWith("gs-tab"),
	);
	expect(markers).toContain("gs-tabrail-close");
	expect(markers).not.toContain("gs-tab-close");
	for (const marker of markers) expect(tab).toContain(marker);
});

test("unused dropdown CSS is allowed, executable dropdown UI is rejected", () => {
	const bundle = fixture();
	expect(() => validatePersonalBundle(bundle)).not.toThrow();
	bundle.set(
		"dist/renderer/dropdown.js",
		Buffer.from('className: "gs-tab-switcher"'),
	);
	expect(() => validatePersonalBundle(bundle)).toThrow(
		"Removed tab dropdown remains in JavaScript",
	);
});

test("preflight catches a bad marker before packaging, with the exact missing name", () => {
	const bundle = fixture();
	const name = "dist/main/index.js";
	bundle.set(
		name,
		Buffer.from(
			bundle
				.get(name)
				?.toString()
				.replace("gs-tabrail-close", "gs-tab-close") ?? "",
		),
	);
	expect(() => validatePersonalBundle(bundle)).toThrow(
		"Bundle contract missing: gs-tabrail-close",
	);
});

test("same-count substituted assets and changed bytes cannot pass package equality", () => {
	const compiled = fixture();
	const packaged = new Map(compiled);
	const html = packaged.get("dist/renderer/computer-overlay.html");
	expect(html).toBeDefined();
	packaged.delete("dist/renderer/computer-overlay.html");
	packaged.set("dist/renderer/other.html", html as Buffer);
	expect(() => compareBundles(compiled, packaged)).toThrow(
		"Missing packaged asset",
	);
	packaged.delete("dist/renderer/other.html");
	packaged.set("dist/renderer/computer-overlay.html", Buffer.from("changed"));
	expect(() => compareBundles(compiled, packaged)).toThrow(
		"Packaged asset differs",
	);
});

test("missing and extra chunks are rejected", () => {
	const compiled = fixture();
	const packaged = new Map(compiled);
	packaged.delete("dist/main/host-service.js");
	expect(() => compareBundles(compiled, packaged)).toThrow(
		"asset inventory differs",
	);
	packaged.set(
		"dist/main/host-service.js",
		compiled.get("dist/main/host-service.js") as Buffer,
	);
	packaged.set("dist/main/extra.js", Buffer.from("extra"));
	expect(() => compareBundles(compiled, packaged)).toThrow(
		"asset inventory differs",
	);
});

test("battery safeguards still reject the old worktree scanner", () => {
	const bundle = fixture();
	bundle.set(
		"dist/main/host-service.js",
		Buffer.from("countUntrackedFileLines"),
	);
	expect(() => validatePersonalBundle(bundle)).toThrow(
		"Untracked line scan returned",
	);
});
