import { describe, expect, it } from "bun:test";
import { createScanState, scanForShellReady } from "./shell-ready-scanner";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("shell-ready scanner (bytes)", () => {
	it("strips the OSC 133;A marker from a single chunk", () => {
		const state = createScanState();
		const r = scanForShellReady(state, enc.encode("hello\x1b]133;A\x07$ "));
		expect(r.matched).toBe(true);
		expect(dec.decode(r.output)).toBe("hello$ ");
	});

	it("matches the marker spanning two chunks without dropping bytes", () => {
		const state = createScanState();
		const a = scanForShellReady(state, enc.encode("\x1b]133"));
		expect(a.matched).toBe(false);
		expect(a.output.length).toBe(0);
		const b = scanForShellReady(state, enc.encode(";A\x07"));
		expect(b.matched).toBe(true);
		expect(b.output.length).toBe(0);
	});

	it("flushes held bytes that turned out not to be a marker", () => {
		const state = createScanState();
		// Starts looking like the marker, then bails on the second char.
		const r = scanForShellReady(state, enc.encode("\x1bX"));
		expect(r.matched).toBe(false);
		expect(dec.decode(r.output)).toBe("\x1bX");
	});

	// The real shell integration terminates its OSC with ST, not BEL. Taking
	// only BEL made the scanner latch on the prefix and swallow the rest of
	// the stream — prompt and all — until the 3s readiness timeout.
	it("accepts an ST-terminated marker, not just BEL", () => {
		const state = createScanState();
		const r = scanForShellReady(state, enc.encode("\x1b]133;A\x1b\\$ "));
		expect(r.matched).toBe(true);
		expect(dec.decode(r.output)).toBe("$ ");
	});

	it("does not swallow the prompt after an ST-terminated marker", () => {
		// Verbatim shape captured from a live pty on 2026-08-09.
		const state = createScanState();
		const r = scanForShellReady(
			state,
			enc.encode(
				"\x1b]133;A\x1b\\\x1b]9;9;C:\\Dev\\SecondBrain\x1b\\PS C:\\Dev\\SecondBrain> ",
			),
		);
		expect(r.matched).toBe(true);
		expect(dec.decode(r.output)).toContain("PS C:\\Dev\\SecondBrain> ");
	});

	it("matches an ST terminator split across chunks", () => {
		const state = createScanState();
		const a = scanForShellReady(state, enc.encode("\x1b]133;A\x1b"));
		expect(a.matched).toBe(false);
		const b = scanForShellReady(state, enc.encode("\\ready"));
		expect(b.matched).toBe(true);
		expect(dec.decode(b.output)).toBe("ready");
	});

	it("releases held bytes when a terminator never arrives", () => {
		// A prefix with no terminator must not buffer output without bound.
		const state = createScanState();
		const payload = `\x1b]133;A${"x".repeat(600)}`;
		const r = scanForShellReady(state, enc.encode(payload));
		expect(r.matched).toBe(false);
		expect(dec.decode(r.output)).toContain("x".repeat(500));
	});

	it("passes UTF-8 bytes through verbatim — even split mid-codepoint", () => {
		// The whole point of the byte scanner: no per-chunk utf-8 decoding,
		// so a smiley split across chunks survives untouched.
		const state = createScanState();
		const smiley = enc.encode("🙂"); // 4 bytes
		const a = scanForShellReady(state, smiley.subarray(0, 2));
		const b = scanForShellReady(state, smiley.subarray(2));
		const combined = new Uint8Array(a.output.length + b.output.length);
		combined.set(a.output, 0);
		combined.set(b.output, a.output.length);
		expect(dec.decode(combined)).toBe("🙂");
	});
});
