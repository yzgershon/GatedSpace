import { expect, test } from "bun:test";
import { FirstTerminalCommand, terminalNamingPrompt } from "./terminal-naming";

test("only a new shell's first submitted command is collected, with simple corrections", () => {
	const collector = new FirstTerminalCommand();
	expect(collector.take("bun tex\x7fst")).toBeUndefined();
	expect(collector.take("\r")).toBe("bun test");
	expect(collector.take("my-password\r")).toBeUndefined();
});
test("agent launchers wait for the actual transcript prompt and sensitive commands are excluded", () => {
	for (const text of [
		"claude",
		"claude-acct --resume xyz",
		"codex --model x",
		"gh auth login",
		"$env:TOKEN='abc'",
		"curl --api-key abc",
	]) {
		expect(terminalNamingPrompt(text)).toBeNull();
	}
	expect(terminalNamingPrompt("bun run dev")).toBe("bun run dev");
});
test("complex input or completion is discarded without collecting later interactive input", () => {
	for (const data of ["git\t", "\x1b[A", "a".repeat(12_001)]) {
		const collector = new FirstTerminalCommand();
		collector.take(data);
		expect(collector.take("secret\r")).toBeUndefined();
		expect(collector.finished).toBe(true);
	}
});
