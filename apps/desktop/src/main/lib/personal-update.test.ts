import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, findPersonalUpdate } from "./personal-update";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "personal-update-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function installer(name: string): Promise<void> {
	await writeFile(join(dir, name), "completed installer");
	await writeFile(join(dir, `${name}.blockmap`), "blockmap");
}

describe("compareVersions", () => {
	it("orders by numeric component, not lexically", () => {
		// The whole reason this is not a string compare: "1.17.9" > "1.17.10"
		// alphabetically, which would offer an older build as an update.
		expect(compareVersions("1.17.10", "1.17.9")).toBeGreaterThan(0);
		expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
		expect(compareVersions("1.17.47", "1.17.47")).toBe(0);
	});
});

describe("findPersonalUpdate", () => {
	it("filters by the running architecture", async () => {
		await installer("GatedSpace-personal-1.18.10-x64.exe");
		await installer("GatedSpace-personal-1.18.9-arm64.exe");
		expect(findPersonalUpdate("1.18.8", dir, "arm64")?.version).toBe("1.18.9");
		expect(findPersonalUpdate("1.18.8", dir, "x64")?.version).toBe("1.18.10");
	});
	it("ignores incomplete builds and stale completion markers", async () => {
		const name = "GatedSpace-personal-1.18.10-arm64.exe";
		await writeFile(join(dir, name), "in progress");
		expect(findPersonalUpdate("1.18.9", dir, "arm64")).toBeNull();
		await installer(name);
		await utimes(join(dir, `${name}.blockmap`), new Date(0), new Date(0));
		expect(findPersonalUpdate("1.18.9", dir, "arm64")).toBeNull();
	});
	it("returns null when no release dir is configured", async () => {
		expect(findPersonalUpdate("1.17.47", null)).toBeNull();
	});

	it("returns null when nothing in the folder is newer", async () => {
		await installer("GatedSpace-personal-1.17.46-arm64.exe");
		await installer("GatedSpace-personal-1.17.47-arm64.exe");
		expect(findPersonalUpdate("1.17.47", dir, "arm64")).toBeNull();
	});

	it("finds a newer installer", async () => {
		await installer("GatedSpace-personal-1.17.48-arm64.exe");
		const found = findPersonalUpdate("1.17.47", dir, "arm64");
		expect(found?.version).toBe("1.17.48");
	});

	/**
	 * The behaviour he asked for by name: three versions behind should be one
	 * click to current, not three clicks walking up the folder.
	 */
	it("jumps straight to the newest, skipping intermediates", async () => {
		await installer("GatedSpace-personal-1.17.45-arm64.exe");
		await installer("GatedSpace-personal-1.17.46-arm64.exe");
		await installer("GatedSpace-personal-1.17.47-arm64.exe");
		await installer("GatedSpace-personal-1.17.48-arm64.exe");
		const found = findPersonalUpdate("1.17.45", dir, "arm64");
		expect(found?.version).toBe("1.17.48");
	});

	/** A public artifact in the same folder must never be offered. */
	it("ignores installers without the -personal marker", async () => {
		await installer("GatedSpace-1.17.99-arm64.exe");
		expect(findPersonalUpdate("1.17.47", dir, "arm64")).toBeNull();
	});

	it("ignores unrelated files", async () => {
		await installer("latest.yml");
		await installer("builder-debug.yml");
		await installer("GatedSpace-personal-1.17.48-arm64.exe.blockmap");
		expect(findPersonalUpdate("1.17.47", dir, "arm64")).toBeNull();
	});

	it("returns null for a release dir that does not exist", () => {
		expect(findPersonalUpdate("1.17.47", join(dir, "nope"))).toBeNull();
	});

	it("carries the full path so the installer can be spawned", async () => {
		await installer("GatedSpace-personal-1.17.48-arm64.exe");
		const found = findPersonalUpdate("1.17.47", dir, "arm64");
		expect(found?.installerPath).toBe(
			join(dir, "GatedSpace-personal-1.17.48-arm64.exe"),
		);
	});
});
