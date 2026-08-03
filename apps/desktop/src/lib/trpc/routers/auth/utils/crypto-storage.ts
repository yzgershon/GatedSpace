import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";
import { getMachineId } from "@superset/shared/host-info";
import { addMagic, detectFormat, stripMagic } from "./crypto-format";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Resolved lazily, and it must stay that way.
 *
 * This module is reachable from the host-service bundle (via auth-functions),
 * and the host service is spawned with ELECTRON_RUN_AS_NODE=1 — plain Node,
 * where `require("electron")` throws MODULE_NOT_FOUND. A static
 * `import { safeStorage } from "electron"` makes that throw at module-load
 * time, so the host service dies with exit code 1 before it can listen and
 * every feature that depends on it goes dead while the window still opens.
 *
 * Keeping the require inside a function also keeps electron out of the
 * host-service dependency graph entirely: rollup hoists an external dep it
 * sees statically into every chunk that reaches it, which is what turned one
 * import into a top-level `require("electron")` in six separate chunks.
 */
function getSafeStorage(): typeof import("electron").safeStorage | null {
	try {
		const electron = require("electron") as Partial<typeof import("electron")>;
		return electron.safeStorage ?? null;
	} catch {
		return null;
	}
}

function deriveKey(salt: Buffer): Buffer {
	return scryptSync(getMachineId(), salt, KEY_LENGTH);
}

/**
 * Encrypts with the OS keystore when it is available, falling back to the
 * legacy machine-id scheme when it is not.
 *
 * The legacy scheme below derives its key from the Windows MachineGuid, which
 * lives in a registry value any local process can read — so it obfuscates
 * rather than protects, and anyone who can read the file can recompute the
 * key. safeStorage uses DPAPI on Windows (Keychain on macOS, libsecret on
 * Linux), which ties the key to the logged-in user account instead.
 *
 * The fallback is kept because safeStorage reports unavailable on a Linux box
 * with no keyring, and refusing to store a token there would break sign-in
 * outright. Blobs are self-describing (see crypto-format), so the two coexist.
 */
export function encryptSecret(plaintext: string): Buffer {
	try {
		const safeStorage = getSafeStorage();
		if (safeStorage?.isEncryptionAvailable()) {
			return addMagic(safeStorage.encryptString(plaintext));
		}
	} catch {
		// safeStorage throws if called before app ready; fall through.
	}
	return encryptLegacy(plaintext);
}

/** Reads either format. Legacy blobs stay readable so nobody is signed out. */
export function decryptSecret(data: Buffer): string {
	if (detectFormat(data) === "safe-storage") {
		const safeStorage = getSafeStorage();
		if (!safeStorage) {
			// Only reachable outside the Electron main process. Say so plainly —
			// the alternative is a TypeError on null that reads like corruption.
			throw new Error(
				"Cannot decrypt a safeStorage blob: electron is unavailable in this process",
			);
		}
		return safeStorage.decryptString(stripMagic(data));
	}
	return decryptLegacy(data);
}

/**
 * True when `data` is still in the old format and should be rewritten.
 * Callers migrate on read so the weak blob does not linger on disk.
 */
export function needsReencryption(data: Buffer): boolean {
	if (detectFormat(data) === "safe-storage") return false;
	try {
		return getSafeStorage()?.isEncryptionAvailable() ?? false;
	} catch {
		return false;
	}
}

/**
 * Encrypts a string using AES-256-GCM with a machine-derived key.
 * Returns: salt (16) + iv (12) + authTag (16) + ciphertext
 */
export function encryptLegacy(plaintext: string): Buffer {
	const salt = randomBytes(SALT_LENGTH);
	const key = deriveKey(salt);
	const iv = randomBytes(IV_LENGTH);

	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	// Combine all components: salt + iv + authTag + ciphertext
	return Buffer.concat([salt, iv, authTag, encrypted]);
}

const MIN_ENCRYPTED_LENGTH = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;

/**
 * Decrypts data encrypted with the legacy machine-id scheme.
 */
export function decryptLegacy(data: Buffer): string {
	if (data.length < MIN_ENCRYPTED_LENGTH) {
		throw new Error("Encrypted data too short");
	}

	// Extract components
	const salt = data.subarray(0, SALT_LENGTH);
	const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
	const authTag = data.subarray(
		SALT_LENGTH + IV_LENGTH,
		SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
	);
	const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

	const key = deriveKey(salt);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	return Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]).toString("utf8");
}
