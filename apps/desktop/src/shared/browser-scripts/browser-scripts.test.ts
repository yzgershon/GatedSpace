import { describe, expect, test } from "bun:test";
import {
	BROWSER_SCRIPT_NAMES,
	BROWSER_SCRIPTS,
	getBrowserScript,
} from "./index";

describe("browser script allowlist", () => {
	test("exposes only the element picker", () => {
		// A guard against the list growing quietly: every entry here becomes
		// script the renderer can run inside whatever page a pane has loaded.
		expect(BROWSER_SCRIPT_NAMES).toEqual(["element-picker"]);
	});

	test("resolves a name to real script text", () => {
		const script = getBrowserScript("element-picker");
		expect(typeof script).toBe("string");
		expect(script.length).toBeGreaterThan(0);
	});

	test("the mapping is the only way to get script text", () => {
		// There is no path from an arbitrary string to executeJavaScript any
		// more; the zod enum rejects anything not a key of this object.
		expect(Object.keys(BROWSER_SCRIPTS)).toEqual([...BROWSER_SCRIPT_NAMES]);
	});
});
