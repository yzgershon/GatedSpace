import { afterEach, expect, test } from "bun:test";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testStorage } from "./test-storage";
import { SyncVault } from "./vault";

const directories: string[] = [];
afterEach(() => {
	for (const dir of directories.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

test("vault persists atomically, never emits secrets, and preserves corrupt files", () => {
	const dir = mkdtempSync(join(tmpdir(), "gatedspace-vault-test-"));
	directories.push(dir);
	const vault = new SyncVault(dir, testStorage);
	// Keep the same simulated OS key across instances.
	const storage = testStorage();
	const first = new SyncVault(dir, () => storage);
	const data = first.read();
	data.account = {
		id: "owner",
		email: "test@example.com",
		token: "secret-token-for-fixture",
	};
	first.write(data);
	expect(
		readFileSync(join(dir, "account.vault")).includes(
			Buffer.from("secret-token"),
		),
	).toBe(false);
	expect(new SyncVault(dir, () => storage).read()).toEqual(data);
	expect(readdirSync(dir)).toEqual(["account.vault"]);
	expect(() => vault.read()).toThrow("preserved");
	writeFileSync(join(dir, "account.vault"), "corrupt");
	expect(() => first.read()).toThrow("preserved");
	expect(readFileSync(join(dir, "account.vault"), "utf8")).toBe("corrupt");
});
test("vault refuses missing OS encryption and Linux basic_text backend", () => {
	for (const storage of [
		{ ...testStorage(), isEncryptionAvailable: () => false },
		{ ...testStorage(), getSelectedStorageBackend: () => "basic_text" },
	]) {
		const dir = mkdtempSync(join(tmpdir(), "gatedspace-vault-test-"));
		directories.push(dir);
		expect(() => new SyncVault(dir, () => storage).read()).toThrow(
			"credential storage",
		);
		expect(readdirSync(dir)).toEqual([]);
	}
});
