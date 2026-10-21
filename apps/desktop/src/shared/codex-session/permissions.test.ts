import { expect, test } from "bun:test";
import { defaultCodexPermission } from "./permissions";

test("personal sessions default to full access; public sessions retain Auto", () => {
	expect(defaultCodexPermission(true)).toBe("full-access");
	expect(defaultCodexPermission(false)).toBe("default");
});
