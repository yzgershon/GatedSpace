import { describe, expect, it } from "bun:test";
import {
	buildElevatedInnerScript,
	buildElevatedLauncherArgs,
	ELEVATION_DECLINED_EXIT_CODE,
	ELEVATION_UNSUPPORTED_MESSAGE,
	encodePowerShellCommand,
	openElevatedTerminal,
} from "./elevated-terminal";

/** What PowerShell itself does with `-EncodedCommand`. */
function decode(base64: string): string {
	return Buffer.from(base64, "base64").toString("utf16le");
}

describe("encodePowerShellCommand", () => {
	it("encodes UTF-16LE, which is the only thing -EncodedCommand accepts", () => {
		// UTF-8 base64 of the same string would decode to mojibake and the
		// elevated shell would run garbage.
		expect(decode(encodePowerShellCommand("Set-Location 'C:\\'"))).toBe(
			"Set-Location 'C:\\'",
		);
	});

	it("survives non-ASCII paths", () => {
		const script = "$p = 'C:\\Users\\Ünïcode\\проект'";
		expect(decode(encodePowerShellCommand(script))).toBe(script);
	});
});

describe("buildElevatedInnerScript", () => {
	it("guards the directory before entering it", () => {
		// A worktree can be deleted between opening the menu and clicking it.
		const script = buildElevatedInnerScript("C:\\Dev\\superset");
		expect(script).toContain("Test-Path -LiteralPath $p");
		expect(script).toContain("Set-Location -LiteralPath $p");
	});

	it("doubles single quotes so a path cannot terminate the literal", () => {
		const script = buildElevatedInnerScript("C:\\Dev\\Yish's Repo");
		expect(script).toContain("'C:\\Dev\\Yish''s Repo'");
	});

	it("cannot be broken out of by a path carrying a quote and a command", () => {
		// The whole point of the escaping: this must stay DATA.
		const hostile = "C:\\tmp'; Remove-Item -Recurse C:\\ ; '";
		const script = buildElevatedInnerScript(hostile);
		// One assignment, and the injected text is inside the literal — the
		// doubled quotes mean nothing after `$p = '` starts a new statement.
		expect(script.match(/\$p = '/g)).toHaveLength(1);
		expect(script).toContain("''; Remove-Item -Recurse C:\\ ; ''");
	});

	it("returns nothing for a blank cwd rather than a broken Set-Location", () => {
		expect(buildElevatedInnerScript("   ")).toBe("");
	});
});

describe("buildElevatedLauncherArgs", () => {
	it("passes the inner script as base64, never as command-line text", () => {
		const args = buildElevatedLauncherArgs("C:\\Dev\\Yish's Repo");
		const command = args.at(-1) ?? "";
		// The raw path must not appear on the launcher's command line at all.
		expect(command).not.toContain("Yish");
		expect(command).toContain("-EncodedCommand");
	});

	it("only ever emits base64 and fixed text", () => {
		const command = buildElevatedLauncherArgs("C:\\a b\\c'd").at(-1) ?? "";
		const encoded = command.match(/'-EncodedCommand','([^']*)'/)?.[1] ?? "";
		expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
		expect(decode(encoded)).toContain("C:\\a b\\c''d");
	});

	it("reports a cancelled prompt as its own exit code", () => {
		// Otherwise "you clicked No" is indistinguishable from "it broke".
		const command = buildElevatedLauncherArgs("C:\\Dev").at(-1) ?? "";
		expect(command).toContain(`exit ${ELEVATION_DECLINED_EXIT_CODE}`);
	});

	it("runs the launcher without a profile, so a slow profile cannot stall it", () => {
		expect(buildElevatedLauncherArgs("C:\\Dev")).toContain("-NoProfile");
	});

	it("keeps the elevated shell open", () => {
		// Without -NoExit the admin window runs Set-Location and vanishes.
		expect(buildElevatedLauncherArgs("C:\\Dev").at(-1)).toContain("'-NoExit'");
	});
});

describe("openElevatedTerminal", () => {
	it("refuses on non-Windows instead of spawning powershell.exe", async () => {
		const result = await openElevatedTerminal("/home/yish", "darwin");
		expect(result.ok).toBe(false);
		expect(result.error).toBe(ELEVATION_UNSUPPORTED_MESSAGE);
	});
});
