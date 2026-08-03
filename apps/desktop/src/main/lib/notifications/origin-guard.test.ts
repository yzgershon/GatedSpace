import { describe, expect, test } from "bun:test";
import { shouldRejectOrigin } from "./origin-guard";

describe("shouldRejectOrigin", () => {
	test("lets through a request with no Origin — that is curl", () => {
		// The real callers: the generated shell hook scripts.
		expect(shouldRejectOrigin(undefined)).toBe(false);
	});

	test("refuses a request from any web page", () => {
		for (const origin of [
			"https://example.com",
			"http://localhost:3000",
			"https://evil.test",
			"null",
		]) {
			expect(shouldRejectOrigin(origin)).toBe(true);
		}
	});

	test("refuses a page claiming our own origin", () => {
		// A page cannot forge Origin, so one that says loopback IS a page —
		// our hook scripts never set the header at all.
		expect(shouldRejectOrigin("http://127.0.0.1:51741")).toBe(true);
	});

	test("refuses an empty Origin rather than treating it as absent", () => {
		// `"" !== undefined`, and a sandboxed iframe sends Origin: null or "".
		expect(shouldRejectOrigin("")).toBe(true);
	});
});
