import { describe, expect, mock, test } from "bun:test";
import { WriteOnlyClipboardProvider } from "./clipboard-provider";

describe("WriteOnlyClipboardProvider", () => {
	test("never discloses the clipboard", async () => {
		// The whole point: an OSC 52 read is answered by injecting the result
		// back into the pty, so a `cat`ed repo file could scrape a password.
		const provider = new WriteOnlyClipboardProvider();
		expect(await provider.readText()).toBe("");
	});

	test("reports empty rather than throwing, so a prober does not hang", async () => {
		const provider = new WriteOnlyClipboardProvider();
		expect(() => provider.readText()).not.toThrow();
		expect(await provider.readText()).toHaveLength(0);
	});

	test("still writes through to the system clipboard", async () => {
		const writeText = mock(() => Promise.resolve());
		const original = globalThis.navigator;
		Object.defineProperty(globalThis, "navigator", {
			value: { clipboard: { writeText } },
			configurable: true,
		});
		try {
			await new WriteOnlyClipboardProvider().writeText("c", "hello");
			expect(writeText).toHaveBeenCalledWith("hello");
		} finally {
			Object.defineProperty(globalThis, "navigator", {
				value: original,
				configurable: true,
			});
		}
	});
});
