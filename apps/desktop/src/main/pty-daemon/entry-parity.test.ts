// The desktop bundle ships its OWN pty-daemon entry, hand-synced with the
// package's main.ts (see the header of ./index.ts). That is a real trap: the
// daemon socket's authentication was added to the package copy and silently
// left out of this one, which is the copy that actually runs — so the shipped
// daemon would have kept accepting unauthenticated connections while the tests
// on the package side all passed.
//
// These assertions are deliberately crude. They check the SOURCE TEXT rather
// than behaviour, because there is no way to observe the two entrypoints from
// a unit test — they are scripts, not exported functions. Crude and present
// beats elegant and absent for a drift this expensive.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP_ENTRY = join(__dirname, "index.ts");
const PACKAGE_ENTRY = join(
	__dirname,
	"../../../../../packages/pty-daemon/src/main.ts",
);

function read(path: string): string {
	return readFileSync(path, "utf8");
}

describe("pty-daemon entry parity", () => {
	test("both entrypoints exist where this test expects them", () => {
		// If the layout moves, fail loudly here rather than silently passing
		// the assertions below against an empty string.
		expect(read(DESKTOP_ENTRY).length).toBeGreaterThan(0);
		expect(read(PACKAGE_ENTRY).length).toBeGreaterThan(0);
	});

	test("the desktop entry authenticates its daemon socket", () => {
		const source = read(DESKTOP_ENTRY);
		expect(source).toContain("authToken");
		expect(source).toContain("ensureDaemonToken");
	});

	test("the package entry authenticates its daemon socket", () => {
		const source = read(PACKAGE_ENTRY);
		expect(source).toContain("authToken");
		expect(source).toContain("ensureDaemonToken");
	});

	test("every Server construction in both entries passes authToken", () => {
		// Reaching the socket means being able to spawn processes and write into
		// live shells, so a Server built without a token is a hole regardless of
		// which code path builds it (fresh spawn vs handoff successor).
		for (const path of [DESKTOP_ENTRY, PACKAGE_ENTRY]) {
			const source = read(path);
			const constructions = source.split("new Server({").slice(1);
			expect(constructions.length).toBeGreaterThan(0);
			for (const block of constructions) {
				const body = block.slice(0, block.indexOf("})"));
				expect(body).toContain("authToken");
			}
		}
	});
});
