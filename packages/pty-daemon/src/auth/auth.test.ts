import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	ensureDaemonToken,
	ptyDaemonTokenPath,
	readDaemonToken,
	verifyDaemonToken,
} from "./auth.ts";

// ensureDaemonToken shells out to icacls on Windows; bun runs test files
// concurrently, so give the spawn headroom on a loaded machine.
const SPAWN_TIMEOUT_MS = 30_000;

let home: string;

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "ptyd-auth-"));
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
});

describe("ptyDaemonTokenPath", () => {
	test("derives from a Windows named pipe", () => {
		expect(
			ptyDaemonTokenPath("\\\\.\\pipe\\superset-ptyd-ab12cd34ef56", home),
		).toBe(path.join(home, "superset-ptyd-ab12cd34ef56.token"));
	});

	test("derives from a POSIX socket, dropping .sock", () => {
		expect(
			ptyDaemonTokenPath("/tmp/superset-ptyd-ab12cd34ef56.sock", home),
		).toBe(path.join(home, "superset-ptyd-ab12cd34ef56.token"));
	});

	test("both transports for one daemon agree on one file", () => {
		// The daemon and its clients derive independently; if these diverged,
		// every connection would fail auth.
		expect(ptyDaemonTokenPath("\\\\.\\pipe\\superset-ptyd-aaa", home)).toBe(
			ptyDaemonTokenPath("/tmp/superset-ptyd-aaa.sock", home),
		);
	});

	test("distinct daemons get distinct tokens", () => {
		expect(ptyDaemonTokenPath("/tmp/superset-ptyd-aaa.sock", home)).not.toBe(
			ptyDaemonTokenPath("/tmp/superset-ptyd-bbb.sock", home),
		);
	});
});

describe("ensureDaemonToken", () => {
	test(
		"creates a 32-byte hex token",
		() => {
			const token = ensureDaemonToken(path.join(home, "t.token"));
			expect(token).toMatch(/^[0-9a-f]{64}$/);
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"is idempotent — second caller reads the first one's token",
		() => {
			// This is what lets the daemon and the client race without ordering.
			const file = path.join(home, "t.token");
			expect(ensureDaemonToken(file)).toBe(ensureDaemonToken(file));
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"creates the parent directory",
		() => {
			const file = path.join(home, "nested", "deep", "t.token");
			expect(ensureDaemonToken(file)).toMatch(/^[0-9a-f]{64}$/);
			expect(fs.existsSync(file)).toBe(true);
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"replaces a corrupt token file rather than failing shut",
		() => {
			const file = path.join(home, "t.token");
			fs.writeFileSync(file, "not-a-token");
			expect(ensureDaemonToken(file)).toMatch(/^[0-9a-f]{64}$/);
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"tolerates trailing whitespace from an editor",
		() => {
			const file = path.join(home, "t.token");
			const token = "a".repeat(64);
			fs.writeFileSync(file, `${token}\n`);
			expect(ensureDaemonToken(file)).toBe(token);
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"two daemons do not share a token",
		() => {
			expect(ensureDaemonToken(path.join(home, "a.token"))).not.toBe(
				ensureDaemonToken(path.join(home, "b.token")),
			);
		},
		SPAWN_TIMEOUT_MS,
	);
});

describe("readDaemonToken", () => {
	test("returns null when absent", () => {
		expect(readDaemonToken(path.join(home, "missing.token"))).toBeNull();
	});

	test("returns null on a malformed token", () => {
		const file = path.join(home, "t.token");
		fs.writeFileSync(file, "zzzz");
		expect(readDaemonToken(file)).toBeNull();
	});

	test("rejects a truncated token", () => {
		// Anchored pattern: a prefix must not authenticate.
		const file = path.join(home, "t.token");
		fs.writeFileSync(file, "a".repeat(63));
		expect(readDaemonToken(file)).toBeNull();
	});
});

describe("verifyDaemonToken", () => {
	const token = "a".repeat(64);

	test("accepts the matching token", () => {
		expect(verifyDaemonToken(token, token)).toBe(true);
	});

	test("rejects a different token of equal length", () => {
		expect(verifyDaemonToken(token, "b".repeat(64))).toBe(false);
	});

	test("rejects a length mismatch without throwing", () => {
		// timingSafeEqual throws on unequal lengths — the guard must come first.
		expect(verifyDaemonToken(token, "a".repeat(10))).toBe(false);
	});

	test("rejects a prefix of the real token", () => {
		expect(verifyDaemonToken(token, token.slice(0, 32))).toBe(false);
	});

	test("rejects non-string values off the wire", () => {
		// `provided` is parsed JSON, so it can be any shape.
		for (const value of [undefined, null, 42, {}, [], true]) {
			expect(verifyDaemonToken(token, value)).toBe(false);
		}
	});

	test("rejects an empty string", () => {
		expect(verifyDaemonToken(token, "")).toBe(false);
	});
});
