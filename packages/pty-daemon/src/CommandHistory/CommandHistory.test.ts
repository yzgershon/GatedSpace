import { describe, expect, test } from "bun:test";
import {
	CommandHistory,
	type CommandHistoryRow,
	isDeniedCommand,
} from "./CommandHistory";

const bytes = (s: string): Uint8Array =>
	Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const osc = (payload: string): string => `\x1b]${payload}\x07`;

/** A full cycle as the wrappers emit it: cwd, prompt, text, start, end. */
function cycle(command: string, exitCode: number, cwd = "/repo"): string {
	return [
		osc(`9;9;${cwd}`),
		osc("133;A"),
		osc(`777;superset-cmd;${command}`),
		osc("133;B"),
		osc("133;C"),
		osc(`133;D;${exitCode}`),
	].join("");
}

function harness() {
	const rows: CommandHistoryRow[] = [];
	let clock = 1000;
	const history = new CommandHistory(
		(row) => rows.push(row),
		() => clock,
	);
	return {
		rows,
		history,
		advance: (ms: number) => {
			clock += ms;
		},
		feed: (sessionId: string, text: string) =>
			history.observe(sessionId, bytes(text)),
	};
}

describe("CommandHistory", () => {
	test("assembles a row from events that arrive at different moments", () => {
		const h = harness();
		h.feed("s1", cycle("git status", 0, "/repo"));
		expect(h.rows).toHaveLength(1);
		expect(h.rows[0]).toMatchObject({
			sessionId: "s1",
			command: "git status",
			cwd: "/repo",
			exitCode: 0,
		});
	});

	test("keeps a non-zero exit, which is the interesting case", () => {
		const h = harness();
		h.feed("s1", cycle("git nonsense", 1));
		expect(h.rows[0]?.exitCode).toBe(1);
	});

	test("measures duration between start and end", () => {
		const h = harness();
		h.feed("s1", osc("777;superset-cmd;sleep 1") + osc("133;C"));
		h.advance(1500);
		h.feed("s1", osc("133;D;0"));
		expect(h.rows[0]?.durationMs).toBe(1500);
	});

	test("carries the cwd from the prompt that preceded the command", () => {
		const h = harness();
		h.feed("s1", cycle("ls", 0, "C:\\Dev\\superset"));
		expect(h.rows[0]?.cwd).toBe("C:\\Dev\\superset");
	});

	test("a command with no exit marker is dropped, not guessed", () => {
		// A shell killed mid-command, or integration that stopped emitting. A row
		// whose exit code is invented is worse than no row.
		const h = harness();
		h.feed("s1", osc("777;superset-cmd;vim") + osc("133;C"));
		h.feed("s1", osc("133;A"));
		expect(h.rows).toHaveLength(0);
	});

	test("an exit with no command is dropped", () => {
		// Integration that loaded mid-command, or a resumed session. Timing
		// without a command is not a history row.
		const h = harness();
		h.feed("s1", osc("133;C") + osc("133;D;0"));
		expect(h.rows).toHaveLength(0);
	});

	test("sessions do not contaminate each other", () => {
		const h = harness();
		h.feed("a", osc("777;superset-cmd;from-a") + osc("133;C"));
		h.feed("b", cycle("from-b", 0));
		h.feed("a", osc("133;D;0"));

		expect(h.rows.map((r) => [r.sessionId, r.command])).toEqual([
			["b", "from-b"],
			["a", "from-a"],
		]);
	});

	test("events split across chunks still produce one row", () => {
		const h = harness();
		const whole = cycle("echo hi", 0);
		for (const ch of whole) h.feed("s1", ch);
		expect(h.rows).toHaveLength(1);
		expect(h.rows[0]?.command).toBe("echo hi");
	});

	test("disposing forgets a half-built row", () => {
		const h = harness();
		h.feed("s1", osc("777;superset-cmd;partial") + osc("133;C"));
		h.history.dispose("s1");
		h.feed("s1", osc("133;D;0"));
		expect(h.rows).toHaveLength(0);
	});

	test("ordinary output produces nothing", () => {
		const h = harness();
		h.feed("s1", "just some program output\r\n");
		expect(h.rows).toHaveLength(0);
	});
});

describe("isDeniedCommand", () => {
	test("drops commands that carry credentials", () => {
		// Shell history is a classic place for secrets to leak: they arrive as
		// arguments, persist in plain text, and get searched long afterwards.
		expect(isDeniedCommand("export GITHUB_TOKEN=abc123")).toBe(true);
		expect(isDeniedCommand("MY_API_KEY=xyz npm run deploy")).toBe(true);
		expect(isDeniedCommand("curl -H 'Authorization: Bearer abc' url")).toBe(
			true,
		);
		expect(isDeniedCommand("mysql --password=hunter2")).toBe(true);
		expect(isDeniedCommand("$env:OPENAI_SECRET = 'x'")).toBe(true);
	});

	test("drops recognisable credential shapes even without a keyword", () => {
		expect(isDeniedCommand("echo ghp_abcdefghijklmnopqrstuvwxyz01")).toBe(true);
		expect(isDeniedCommand("use sk-abcdefghijklmnopqrstuvwx")).toBe(true);
	});

	test("does NOT drop ordinary commands", () => {
		// Over-matching is its own failure: a history that quietly discards
		// normal commands is one nobody can trust or debug.
		expect(isDeniedCommand("git status")).toBe(false);
		expect(isDeniedCommand("npm run build")).toBe(false);
		expect(isDeniedCommand("cd C:\\Dev\\superset")).toBe(false);
		expect(isDeniedCommand("grep -r token src/")).toBe(false);
		expect(isDeniedCommand("cat secrets.md")).toBe(false);
	});

	test("a denied command is dropped whole, not stored redacted", () => {
		const h = harness();
		h.feed("s1", cycle("export AWS_SECRET_ACCESS_KEY=abc", 0));
		expect(h.rows).toHaveLength(0);
	});
});
