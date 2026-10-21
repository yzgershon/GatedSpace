import { expect, mock, test } from "bun:test";

mock.module("renderer/env.renderer", () => ({
	env: { NEXT_PUBLIC_LOCAL_ONLY: "1" },
}));
const { isLocalMode } = await import("./local-mode");
test("public builds stay local even with an old cloud preference", () => {
	const previous = globalThis.window;
	Object.assign(globalThis, {
		window: { localStorage: { getItem: () => "cloud" } },
	});
	try {
		expect(isLocalMode()).toBe(true);
	} finally {
		Object.assign(globalThis, { window: previous });
	}
});
