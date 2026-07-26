import { describe, expect, it } from "bun:test";
import { NdjsonLineBuffer } from "./ndjson-line-buffer";

describe("NdjsonLineBuffer", () => {
	it("splits a clean multi-line chunk", () => {
		const buf = new NdjsonLineBuffer();
		expect(buf.push('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
		expect(buf.isEmpty).toBe(true);
	});

	it("holds a trailing partial until the next chunk completes it", () => {
		const buf = new NdjsonLineBuffer();
		expect(buf.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
		expect(buf.isEmpty).toBe(false);
		expect(buf.push("2}\n")).toEqual(['{"b":2}']);
		expect(buf.isEmpty).toBe(true);
	});

	it("reassembles a single object split across three chunks", () => {
		const buf = new NdjsonLineBuffer();
		expect(buf.push('{"typ')).toEqual([]);
		expect(buf.push('e":"sys')).toEqual([]);
		expect(buf.push('tem"}\n')).toEqual(['{"type":"system"}']);
	});

	it("handles Windows CRLF line endings", () => {
		const buf = new NdjsonLineBuffer();
		expect(buf.push('{"a":1}\r\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}']);
	});

	it("emits multiple complete lines plus retains a partial from one chunk", () => {
		const buf = new NdjsonLineBuffer();
		expect(buf.push('{"a":1}\n{"b":2}\n{"c":')).toEqual(['{"a":1}', '{"b":2}']);
		expect(buf.push("3}\n")).toEqual(['{"c":3}']);
	});

	it("flush() returns a final unterminated line", () => {
		const buf = new NdjsonLineBuffer();
		expect(buf.push('{"a":1}')).toEqual([]);
		expect(buf.flush()).toEqual(['{"a":1}']);
		expect(buf.flush()).toEqual([]);
	});

	it("flush() returns nothing when the buffer ended on a newline", () => {
		const buf = new NdjsonLineBuffer();
		buf.push('{"a":1}\n');
		expect(buf.flush()).toEqual([]);
	});

	it("preserves empty lines between objects (caller filters them)", () => {
		const buf = new NdjsonLineBuffer();
		expect(buf.push('{"a":1}\n\n{"b":2}\n')).toEqual([
			'{"a":1}',
			"",
			'{"b":2}',
		]);
	});
});
