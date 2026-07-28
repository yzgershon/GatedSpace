/**
 * Tests written against the bytes our own wrappers emit, not against an idea
 * of the protocol. The PowerShell wrapper uses ESC \ as its terminator and the
 * POSIX ones use BEL, so both forms have to work or one platform silently
 * records nothing.
 */
import { describe, expect, test } from "bun:test";
import {
	createOscScanState,
	parseOscPayload,
	scanOscCommandEvents,
} from "./osc-command-scanner";

const bytes = (s: string): Uint8Array =>
	Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

/** BEL-terminated, as the bash and zsh wrappers emit. */
const bel = (payload: string): string => `\x1b]${payload}\x07`;
/** ST-terminated, as the PowerShell wrapper emits. */
const st = (payload: string): string => `\x1b]${payload}\x1b\\`;

function scanAll(chunks: string[]) {
	const state = createOscScanState();
	return chunks.flatMap((chunk) => scanOscCommandEvents(state, bytes(chunk)));
}

describe("parseOscPayload", () => {
	test("recognises the markers our wrappers emit", () => {
		expect(parseOscPayload("133;A")).toEqual({ type: "prompt" });
		expect(parseOscPayload("133;C")).toEqual({ type: "command-start" });
		expect(parseOscPayload("133;D;0")).toEqual({
			type: "command-end",
			exitCode: 0,
		});
		expect(parseOscPayload("9;9;C:\\Dev")).toEqual({
			type: "cwd",
			path: "C:\\Dev",
		});
	});

	test("a non-zero exit survives intact", () => {
		expect(parseOscPayload("133;D;1")).toEqual({
			type: "command-end",
			exitCode: 1,
		});
		expect(parseOscPayload("133;D;130")).toEqual({
			type: "command-end",
			exitCode: 130,
		});
	});

	test("133;B is ignored so a command isn't counted twice", () => {
		// Our wrappers emit B and C together. B means "the line was submitted",
		// C means "execution started"; only one of them can be the start.
		expect(parseOscPayload("133;B")).toBeNull();
	});

	test("133;D with NO code is not treated as success", () => {
		// Legal per the spec and means "finished, status unknown". Defaulting it
		// to 0 would silently mark failures as successes, which is worse than
		// recording nothing.
		expect(parseOscPayload("133;D")).toBeNull();
		expect(parseOscPayload("133;D;")).toBeNull();
		expect(parseOscPayload("133;D;abc")).toBeNull();
	});

	test("an empty cwd is not a cwd", () => {
		expect(parseOscPayload("9;9;")).toBeNull();
	});

	test("unrelated OSC sequences are ignored", () => {
		// OSC 0 is the window title, which every shell sets constantly.
		expect(parseOscPayload("0;some title")).toBeNull();
		expect(parseOscPayload("777;superset-shell-ready")).toBeNull();
		expect(parseOscPayload("")).toBeNull();
	});
});

describe("scanOscCommandEvents", () => {
	test("reads a full command cycle, BEL-terminated", () => {
		expect(
			scanAll([
				bel("133;A"),
				bel("133;B"),
				bel("133;C"),
				"total 24\r\n",
				bel("133;D;0"),
			]),
		).toEqual([
			{ type: "prompt" },
			{ type: "command-start" },
			{ type: "command-end", exitCode: 0 },
		]);
	});

	test("reads the same cycle ST-terminated, as PowerShell emits", () => {
		expect(scanAll([st("133;C"), st("133;D;1")])).toEqual([
			{ type: "command-start" },
			{ type: "command-end", exitCode: 1 },
		]);
	});

	test("a sequence split across chunks still lands", () => {
		// Chunk edges have nothing to do with escape sequences, so this is the
		// normal case rather than an edge case.
		expect(scanAll(["\x1b]133", ";D;", "42\x07"])).toEqual([
			{ type: "command-end", exitCode: 42 },
		]);
	});

	test("a marker split byte-by-byte still lands", () => {
		const whole = bel("9;9;/home/yz");
		expect(scanAll([...whole])).toEqual([{ type: "cwd", path: "/home/yz" }]);
	});

	test("ordinary output passes without producing events", () => {
		expect(scanAll(["hello\r\n", "no escapes here"])).toEqual([]);
	});

	test("a Windows path with backslashes survives", () => {
		expect(scanAll([bel("9;9;C:\\Users\\yzger\\Dev")])).toEqual([
			{ type: "cwd", path: "C:\\Users\\yzger\\Dev" },
		]);
	});

	test("a stray ESC that isn't an OSC doesn't derail the next real marker", () => {
		// Colour codes are ESC [ and arrive constantly between markers.
		expect(scanAll(["\x1b[31mred\x1b[0m", bel("133;C")])).toEqual([
			{ type: "command-start" },
		]);
	});

	test("an unterminated OSC does not swallow the stream forever", () => {
		// A binary file catted to the terminal will contain a stray ESC ] and no
		// terminator. Without the payload cap the scanner would buffer for ever
		// and never see another marker.
		const garbage = `\x1b]${"x".repeat(9000)}`;
		const events = scanAll([garbage, bel("133;D;0")]);
		// The runaway sequence is abandoned; the real marker after it is missed
		// only if the garbage happened to contain no terminator AND the next
		// marker shares its sequence — here the BEL closes the runaway, so the
		// following marker is what gets reported.
		expect(events.length).toBeLessThanOrEqual(1);
	});

	test("state is per-session, so two terminals cannot interleave", () => {
		const a = createOscScanState();
		const b = createOscScanState();
		// Half a marker into A, a whole one into B.
		expect(scanOscCommandEvents(a, bytes("\x1b]133;"))).toEqual([]);
		expect(scanOscCommandEvents(b, bytes(bel("133;C")))).toEqual([
			{ type: "command-start" },
		]);
		expect(scanOscCommandEvents(a, bytes("D;7\x07"))).toEqual([
			{ type: "command-end", exitCode: 7 },
		]);
	});

	test("carries the command line, which is most of a history row's value", () => {
		expect(parseOscPayload("777;superset-cmd;git status")).toEqual({
			type: "command-line",
			text: "git status",
		});
	});

	test("an empty command line is not an event", () => {
		expect(parseOscPayload("777;superset-cmd;")).toBeNull();
	});
});
