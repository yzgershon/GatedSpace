import { describe, expect, test } from "bun:test";
import { matchSwapCandidate, parseSwapCommand } from "./swap-command";

const ACCOUNTS = [
	{ id: "yish", label: "Yish", email: "yzgershon@gmail.com" },
	{ id: "amitai", label: "Amitai", email: "amitaiszur@gmail.com" },
	{ id: "robbie", label: "Robbie", email: "yishaigershon5@gmail.com" },
];

describe("parseSwapCommand", () => {
	test("bare command asks for the picker", () => {
		expect(parseSwapCommand("/swap")).toEqual({ query: "" });
		expect(parseSwapCommand("  /swap  ")).toEqual({ query: "" });
		expect(parseSwapCommand("/SWAP")).toEqual({ query: "" });
	});

	test("an argument is the account to pick", () => {
		expect(parseSwapCommand("/swap amitai")).toEqual({ query: "amitai" });
		expect(parseSwapCommand("/swap  Robbie ")).toEqual({ query: "Robbie" });
	});

	test("the leading slash is required", () => {
		// "swap" is an ordinary word; stealing it out of a prompt would be worse
		// than not having the command.
		expect(parseSwapCommand("swap accounts for me")).toBeNull();
	});

	test("a longer word starting with swap is not the command", () => {
		expect(parseSwapCommand("/swapfile")).toBeNull();
	});
});

describe("matchSwapCandidate", () => {
	test("matches an id, a label, an email, and an email local part", () => {
		expect(matchSwapCandidate(ACCOUNTS, "amitai")?.id).toBe("amitai");
		expect(matchSwapCandidate(ACCOUNTS, "Robbie")?.id).toBe("robbie");
		expect(matchSwapCandidate(ACCOUNTS, "yzgershon@gmail.com")?.id).toBe(
			"yish",
		);
		expect(matchSwapCandidate(ACCOUNTS, "yishaigershon5")?.id).toBe("robbie");
	});

	test("matches a unique prefix", () => {
		expect(matchSwapCandidate(ACCOUNTS, "am")?.id).toBe("amitai");
	});

	test("refuses an ambiguous prefix rather than guessing", () => {
		const pair = [
			{ id: "work", label: "Work" },
			{ id: "workshop", label: "Workshop" },
		];
		expect(matchSwapCandidate(pair, "work")?.id).toBe("work"); // exact wins
		expect(matchSwapCandidate(pair, "wor")).toBeNull();
	});

	test("an empty query is never a match", () => {
		expect(matchSwapCandidate(ACCOUNTS, "  ")).toBeNull();
	});
});
