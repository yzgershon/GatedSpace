import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureSecureDir, restrictToCurrentUser } from "./secure-fs.ts";

// Every case here shells out to icacls. Bun runs test files concurrently, so
// a dozen of those land at once and the default 5s is not enough headroom on
// a loaded machine — in isolation this file finishes in ~600ms.
const SPAWN_TIMEOUT_MS = 30_000;

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "ptyd-securefs-"));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe("restrictToCurrentUser", () => {
	// Regression: the first version passed the (OI)(CI) inheritance flags for
	// every target. icacls rejects those on a file, so /grant failed while
	// /inheritance:r had already applied — leaving an empty DACL that locked
	// the owner out of their own token file. The failure is silent (icacls
	// errors are swallowed by design), so only an access check catches it.
	test(
		"leaves a file readable, writable and deletable by its owner",
		() => {
			const file = path.join(root, "secret.token");
			fs.writeFileSync(file, "payload");

			restrictToCurrentUser(file);

			expect(fs.readFileSync(file, "utf8")).toBe("payload");
			fs.appendFileSync(file, "-more");
			expect(fs.readFileSync(file, "utf8")).toBe("payload-more");
			fs.unlinkSync(file);
			expect(fs.existsSync(file)).toBe(false);
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"leaves a directory usable — create, read and delete children",
		() => {
			const dir = path.join(root, "logs");
			fs.mkdirSync(dir);

			restrictToCurrentUser(dir);

			const child = path.join(dir, "a.log");
			fs.writeFileSync(child, "line");
			expect(fs.readFileSync(child, "utf8")).toBe("line");
			expect(fs.readdirSync(dir)).toEqual(["a.log"]);
			fs.rmSync(dir, { recursive: true });
			expect(fs.existsSync(dir)).toBe(false);
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"a file created after the directory is restricted is still usable",
		() => {
			// This is the real shape: the daemon restricts the scrollback dir once
			// at startup, then writes session logs into it for days.
			const dir = path.join(root, "scrollback");
			fs.mkdirSync(dir);
			restrictToCurrentUser(dir);

			const later = path.join(dir, "session.log");
			fs.appendFileSync(later, "output", { mode: 0o600 });
			expect(fs.readFileSync(later, "utf8")).toBe("output");
		},
		SPAWN_TIMEOUT_MS,
	);

	test("a missing path is a no-op rather than a throw", () => {
		expect(() => restrictToCurrentUser(path.join(root, "nope"))).not.toThrow();
	});
});

describe("ensureSecureDir", () => {
	test(
		"creates the directory and leaves it writable",
		() => {
			const dir = path.join(root, "fresh");
			ensureSecureDir(dir);
			expect(fs.statSync(dir).isDirectory()).toBe(true);
			fs.writeFileSync(path.join(dir, "x"), "y");
			expect(fs.readFileSync(path.join(dir, "x"), "utf8")).toBe("y");
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"creates intermediate directories",
		() => {
			const dir = path.join(root, "a", "b", "c");
			ensureSecureDir(dir);
			expect(fs.statSync(dir).isDirectory()).toBe(true);
		},
		SPAWN_TIMEOUT_MS,
	);

	test(
		"is idempotent and does not lock an existing directory",
		() => {
			const dir = path.join(root, "again");
			ensureSecureDir(dir);
			fs.writeFileSync(path.join(dir, "keep"), "1");
			ensureSecureDir(dir);
			expect(fs.readFileSync(path.join(dir, "keep"), "utf8")).toBe("1");
		},
		SPAWN_TIMEOUT_MS,
	);
});
