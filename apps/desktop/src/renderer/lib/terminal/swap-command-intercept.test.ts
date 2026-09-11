import { describe, expect, test } from "bun:test";
import {
	createSwapInterceptState,
	interceptSwapCommand,
} from "./swap-command-intercept";

/** Type a string one keypress at a time, the way xterm delivers it. */
function type(
	state: ReturnType<typeof createSwapInterceptState>,
	text: string,
): string[] {
	return [...text].map((char) => interceptSwapCommand(state, char).forward);
}

describe("interceptSwapCommand", () => {
	test("passes ordinary typing through unchanged", () => {
		const state = createSwapInterceptState();
		expect(type(state, "ls -la").join("")).toBe("ls -la");
		const enter = interceptSwapCommand(state, "\r");
		expect(enter.forward).toBe("\r");
		expect(enter.swapQuery).toBeUndefined();
	});

	test("catches /swap and erases what was typed instead of running it", () => {
		const state = createSwapInterceptState();
		type(state, "/swap");
		const enter = interceptSwapCommand(state, "\r");
		expect(enter.swapQuery).toBe("");
		// Five DELs for five characters, and no carriage return.
		expect(enter.forward).toBe("\x7f".repeat(5));
		expect(enter.forward).not.toContain("\r");
	});

	test("carries the account name through", () => {
		const state = createSwapInterceptState();
		type(state, "/swap amitai");
		expect(interceptSwapCommand(state, "\r").swapQuery).toBe("amitai");
	});

	test("backspace keeps the buffer honest", () => {
		const state = createSwapInterceptState();
		type(state, "/swapx");
		interceptSwapCommand(state, "\x7f");
		const enter = interceptSwapCommand(state, "\r");
		expect(enter.swapQuery).toBe("");
		expect(enter.forward).toBe("\x7f".repeat(5));
	});

	test("an escape sequence resets, so the line is typed through", () => {
		const state = createSwapInterceptState();
		type(state, "/swap");
		// Up arrow: whatever is on screen now is history, not what we tracked.
		interceptSwapCommand(state, "\x1b[A");
		const enter = interceptSwapCommand(state, "\r");
		expect(enter.swapQuery).toBeUndefined();
		expect(enter.forward).toBe("\r");
	});

	test("Ctrl-C resets", () => {
		const state = createSwapInterceptState();
		type(state, "/swap");
		interceptSwapCommand(state, "\x03");
		expect(interceptSwapCommand(state, "\r").swapQuery).toBeUndefined();
	});

	test("a pasted line is caught too", () => {
		const state = createSwapInterceptState();
		const result = interceptSwapCommand(state, "/swap robbie\r");
		expect(result.swapQuery).toBe("robbie");
		expect(result.forward).toBe("\x7f".repeat("/swap robbie".length));
	});

	test("a multiline paste is never treated as the command", () => {
		const state = createSwapInterceptState();
		const result = interceptSwapCommand(state, "echo one\necho two\n");
		expect(result.swapQuery).toBeUndefined();
		expect(result.forward).toBe("echo one\necho two\n");
	});

	test("a similar word is not the command", () => {
		const state = createSwapInterceptState();
		type(state, "/swapfile");
		expect(interceptSwapCommand(state, "\r").swapQuery).toBeUndefined();
	});

	test("the buffer starts fresh after each line", () => {
		const state = createSwapInterceptState();
		type(state, "echo hi");
		interceptSwapCommand(state, "\r");
		type(state, "/swap");
		expect(interceptSwapCommand(state, "\r").swapQuery).toBe("");
	});
});
