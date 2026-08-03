import { describe, expect, test } from "bun:test";
import { checkLocalAbsolutePath, isUncPath } from "./local-path";

describe("isUncPath", () => {
	test("recognises a UNC path", () => {
		// The attack: Windows connects to the host and authenticates before
		// anything opens, handing over a NetNTLMv2 hash.
		expect(isUncPath("\\\\attacker.test\\share\\file.txt")).toBe(true);
		expect(isUncPath("//attacker.test/share/file.txt")).toBe(true);
	});

	test("recognises extended-length UNC", () => {
		expect(isUncPath("\\\\?\\UNC\\attacker.test\\share\\x")).toBe(true);
		expect(isUncPath("\\\\?\\unc\\attacker.test\\share\\x")).toBe(true);
	});

	test("allows extended-length LOCAL paths", () => {
		// Same leading backslashes, but local — must not be swept up.
		expect(isUncPath("\\\\?\\C:\\Users\\me\\file.txt")).toBe(false);
		expect(isUncPath("\\\\.\\C:\\Users\\me\\file.txt")).toBe(false);
	});

	test("allows ordinary local paths", () => {
		expect(isUncPath("C:\\Users\\me\\file.txt")).toBe(false);
		expect(isUncPath("/home/me/file.txt")).toBe(false);
		expect(isUncPath("./relative")).toBe(false);
	});

	test("is not fooled by a single leading separator", () => {
		expect(isUncPath("\\single")).toBe(false);
	});
});

describe("checkLocalAbsolutePath", () => {
	test("refuses a UNC path even though it is absolute", () => {
		// This is the bug the old isAbsolute-only check had: UNC IS absolute.
		expect(checkLocalAbsolutePath("\\\\attacker.test\\share\\x")).toBe("unc");
	});

	test("refuses a relative path", () => {
		expect(checkLocalAbsolutePath("relative/file.txt")).toBe("not-absolute");
		expect(checkLocalAbsolutePath("../escape")).toBe("not-absolute");
		expect(checkLocalAbsolutePath("")).toBe("not-absolute");
	});

	test("accepts a local absolute path for this platform", () => {
		const local =
			process.platform === "win32" ? "C:\\Users\\me\\file.txt" : "/home/me/f";
		expect(checkLocalAbsolutePath(local)).toBeNull();
	});

	test("reports unc before not-absolute so the message is the useful one", () => {
		// A forward-slash UNC is not `isAbsolute` on Windows, but "this is a
		// network path" explains the refusal better than "not absolute".
		expect(checkLocalAbsolutePath("//host/share/x")).toBe("unc");
	});
});
