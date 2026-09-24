import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ensureSecureDir, writeSecureFile } from "../secure-file/secure-file";

const accountSchema = z.object({
	id: z.string().min(1),
	email: z.email(),
	token: z.string().min(16).optional(),
	expiresAt: z.number().optional(),
	recoveryKey: z
		.string()
		.regex(/^[A-Za-z0-9_-]{43}$/)
		.optional(),
});
export const vaultSchema = z.object({
	version: z.literal(1),
	deviceId: z.uuid(),
	origin: z.literal("https://gatedspace-sync.vercel.app"),
	account: accountSchema.nullable(),
});
export type SyncVaultData = z.infer<typeof vaultSchema>;
export interface SecretStorage {
	isEncryptionAvailable(): boolean;
	getSelectedStorageBackend?(): string;
	encryptString(value: string): Buffer;
	decryptString(value: Buffer): string;
}

/** Never fall back to a machine ID or plaintext when the OS vault is locked. */
export class SyncVault {
	constructor(
		readonly directory: string,
		private storage: () => SecretStorage,
	) {}
	private cipher() {
		const storage = this.storage();
		if (
			!storage.isEncryptionAvailable() ||
			storage.getSelectedStorageBackend?.() === "basic_text"
		)
			throw new Error(
				"Unlock your operating system's credential storage to use Sync.",
			);
		return storage;
	}
	read(): SyncVaultData {
		const cipher = this.cipher();
		const path = join(this.directory, "account.vault");
		if (!existsSync(path))
			return {
				version: 1,
				deviceId: randomUUID(),
				origin: "https://gatedspace-sync.vercel.app",
				account: null,
			};
		try {
			return vaultSchema.parse(
				JSON.parse(cipher.decryptString(readFileSync(path))),
			);
		} catch {
			throw new Error(
				"This computer's Sync credentials could not be unlocked. The saved vault has been preserved.",
			);
		}
	}
	write(data: SyncVaultData) {
		this.writeDocument("account.vault", vaultSchema.parse(data));
	}
	readDocument<T>(name: string, schema: z.ZodType<T>, fallback: T): T {
		if (!/^[a-z0-9][a-z0-9-]*\.vault$/.test(name))
			throw new Error("Invalid vault document.");
		const path = join(this.directory, name);
		const cipher = this.cipher();
		if (!existsSync(path)) return fallback;
		try {
			return schema.parse(JSON.parse(cipher.decryptString(readFileSync(path))));
		} catch {
			throw new Error(
				"Saved Sync data could not be unlocked. The original file has been preserved.",
			);
		}
	}
	writeDocument(name: string, data: unknown) {
		if (!/^[a-z0-9][a-z0-9-]*\.vault$/.test(name))
			throw new Error("Invalid vault document.");
		const encrypted = this.cipher().encryptString(JSON.stringify(data));
		ensureSecureDir(this.directory);
		const temporary = join(this.directory, `${randomUUID()}.tmp`);
		try {
			writeSecureFile(temporary, encrypted);
			renameSync(temporary, join(this.directory, name));
		} finally {
			if (existsSync(temporary)) unlinkSync(temporary);
		}
	}
}
