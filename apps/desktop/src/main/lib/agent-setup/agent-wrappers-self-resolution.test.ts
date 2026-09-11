/**
 * The wrapper must never resolve to itself.
 *
 * This is a string test on the generated script rather than an execution test,
 * on purpose: `agent-wrappers.test.ts` runs the wrappers for real with
 * `execFileSync`, and on Windows that is exactly how this bug presented — the
 * wrapper found itself, exec'd itself, and forked until bash reported
 * `shell level (1000) too high`, taking a four-hour test run with it. A test
 * that reproduces a fork bomb to prove a fork bomb is fixed is not a test worth
 * having on the machine it fails on.
 *
 * What made it possible: `BIN_DIR` is interpolated by Node, so on Windows the
 * skip pattern reads `C:\Users\you\.superset\bin` while `$PATH` inside Git Bash
 * arrives as `/c/Users/you/.superset/bin`. The `case` never matches. A default
 * install is saved only by the `"$HOME"/.superset/bin` pattern happening to be
 * in POSIX form; move `SUPERSET_HOME_DIR` anywhere else — which is precisely
 * what dev mode does — and nothing catches it.
 */
import { describe, expect, it } from "bun:test";
import { buildWrapperScript } from "./agent-wrappers-common";

const script = buildWrapperScript("codex", 'exec "$REAL_BIN" "$@"', {
	agentId: "codex",
});

/**
 * Bash's parameter expansion, assembled rather than written literally.
 *
 * Biome's `noTemplateCurlyInString` flags `${` inside a plain string as a
 * forgotten template literal, and it is usually right. Here the string is BASH,
 * and the rule cannot tell the difference. Building the opener keeps the
 * assertions exact instead of loosening them to work around the lint.
 */
const EXPAND = `$${"{"}`;

describe("wrapper self-resolution", () => {
	it("compares the file, not the spelling of the path", () => {
		// `-ef` is the whole fix: it asks the filesystem whether two paths are the
		// same file, which no amount of Windows-versus-MSYS string juggling can
		// answer. If this assertion ever fails, the wrapper is one PATH ordering
		// away from forking until the shell dies.
		expect(script).toContain('"$candidate" -ef "$SUPERSET_WRAPPER_SELF"');
	});

	it("knows its own path", () => {
		// BASH_SOURCE rather than $0: the .cmd shim invokes the wrapper by an
		// absolute path that $0 does not always carry intact.
		expect(script).toContain(
			`SUPERSET_WRAPPER_SELF="${EXPAND}BASH_SOURCE[0]}"`,
		);
	});

	it("bounds recursion even if the self-check misses", () => {
		expect(script).toContain(
			`SUPERSET_WRAPPER_DEPTH="${EXPAND}SUPERSET_WRAPPER_DEPTH:-0}"`,
		);
		expect(script).toContain('if [ "$SUPERSET_WRAPPER_DEPTH" -ge 3 ]; then');
		// It must EXIT rather than fall through, or the guard counts to three and
		// then forks anyway.
		expect(script).toContain("exit 127");
	});

	it("still skips the wrapper directory by name on POSIX", () => {
		// The cheap first pass stays. It is correct on Linux and macOS, where
		// BIN_DIR and PATH agree, and it saves a stat per PATH entry.
		expect(script).toContain('"$HOME"/.superset/bin');
	});

	it("checks executability before the self-check, and directories too", () => {
		// A directory called `codex` on PATH used to be skipped by `! -d`; keep it.
		expect(script).toContain('[ -x "$candidate" ] || continue');
		expect(script).toContain('[ -d "$candidate" ] && continue');
	});
});
