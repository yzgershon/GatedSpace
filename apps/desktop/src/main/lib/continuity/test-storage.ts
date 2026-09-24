import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretStorage } from "./vault";
export function testStorage(): SecretStorage {
	const key = randomBytes(32);
	return {
		isEncryptionAvailable: () => true,
		encryptString(value) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
			return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
		},
		decryptString(value) {
			const cipher = createDecipheriv(
				"aes-256-gcm",
				key,
				value.subarray(0, 12),
			);
			cipher.setAuthTag(value.subarray(12, 28));
			return Buffer.concat([
				cipher.update(value.subarray(28)),
				cipher.final(),
			]).toString();
		},
	};
}
