import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { browserSnapshotScript } from "./agent-browser-snapshot";

function page() {
	const button = {
		tagName: "BUTTON",
		innerText: "Save settings",
		getAttribute: () => null,
		getBoundingClientRect: () => ({ width: 100, height: 32 }),
	};
	const hidden = {
		...button,
		getBoundingClientRect: () => ({ width: 0, height: 0 }),
	};
	const context = createContext({
		document: {
			title: "Bot settings",
			body: { innerText: "Configuration" },
			querySelectorAll: (selector: string) =>
				selector === "iframe" ? [] : [button, hidden],
		},
		location: { href: "https://example.test/settings" },
		getComputedStyle: () => ({ visibility: "visible", display: "block" }),
	});
	return { context, button };
}

test("page snapshots work without page crypto and retain usable visible-element refs", () => {
	const { context, button } = page();
	expect(runInContext("typeof crypto", context)).toBe("undefined");
	const result = runInContext(browserSnapshotScript(), context);
	expect(result.title).toBe("Bot settings");
	expect(result.text).toBe("Configuration");
	expect(result.elements).toHaveLength(1);
	expect(result.elements[0].ref).toMatch(/^e[0-9a-f]{8}-0$/);
	expect(result.elements[0].text).toBe("Save settings");
	expect(context.__gsBrowserElements.get(result.elements[0].ref)).toBe(button);
});

test("a new snapshot replaces old refs even when page crypto lacks randomUUID", () => {
	const { context, button } = page();
	context.crypto = {};
	const first = runInContext(browserSnapshotScript(), context);
	const second = runInContext(browserSnapshotScript(), context);
	expect(second.elements[0].ref).not.toBe(first.elements[0].ref);
	expect(context.__gsBrowserElements.has(first.elements[0].ref)).toBe(false);
	expect(context.__gsBrowserElements.get(second.elements[0].ref)).toBe(button);
});
