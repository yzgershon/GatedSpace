import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionLogger } from "./SessionLogger.ts";

function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pty-daemon-session-log-"));
}

describe("SessionLogger", () => {
	test("appends output and flushes on closeAll", () => {
		const dir = tmpDir();
		const logger = new SessionLogger(dir);
		logger.append("s1", Buffer.from("hello "));
		logger.append("s1", Buffer.from("world"));
		logger.closeAll();
		expect(fs.readFileSync(path.join(dir, "s1.log"), "utf8")).toBe(
			"hello world",
		);
	});

	test("sessionExited flushes the tail and keeps the file", () => {
		const dir = tmpDir();
		const logger = new SessionLogger(dir);
		logger.append("s1", Buffer.from("last words"));
		logger.sessionExited("s1");
		expect(fs.readFileSync(path.join(dir, "s1.log"), "utf8")).toBe(
			"last words",
		);
		logger.closeAll();
	});

	test("continues an existing log across logger restarts (daemon handoff)", () => {
		const dir = tmpDir();
		const first = new SessionLogger(dir);
		first.append("s1", Buffer.from("before|"));
		first.closeAll();
		const second = new SessionLogger(dir);
		second.append("s1", Buffer.from("after"));
		second.closeAll();
		expect(fs.readFileSync(path.join(dir, "s1.log"), "utf8")).toBe(
			"before|after",
		);
	});

	test("rotates once at the size cap instead of growing without bound", () => {
		const dir = tmpDir();
		const logger = new SessionLogger(dir, { maxFileBytes: 10 });
		logger.append("s1", Buffer.from("0123456789"));
		logger.closeAll();
		const again = new SessionLogger(dir, { maxFileBytes: 10 });
		again.append("s1", Buffer.from("overflow"));
		again.closeAll();
		expect(fs.readFileSync(path.join(dir, "s1.1.log"), "utf8")).toBe(
			"0123456789",
		);
		expect(fs.readFileSync(path.join(dir, "s1.log"), "utf8")).toBe("overflow");
	});

	test("sweeps logs older than the retention window on construction", () => {
		const dir = tmpDir();
		const stale = path.join(dir, "old.log");
		const fresh = path.join(dir, "new.log");
		fs.writeFileSync(stale, "stale");
		fs.writeFileSync(fresh, "fresh");
		const past = new Date(Date.now() - 60 * 60 * 1000);
		fs.utimesSync(stale, past, past);
		new SessionLogger(dir, { retentionMs: 30 * 60 * 1000 }).closeAll();
		expect(fs.existsSync(stale)).toBe(false);
		expect(fs.existsSync(fresh)).toBe(true);
	});
});
