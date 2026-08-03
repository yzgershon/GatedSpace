// Which scheme a stored blob was written with.
//
// Kept free of electron imports so it can be unit tested — importing electron
// outside a real Electron process fails to resolve.

/**
 * Marks a blob encrypted with the OS keystore (DPAPI on Windows, Keychain on
 * macOS, libsecret on Linux) via Electron's safeStorage.
 *
 * Legacy blobs begin with 16 random salt bytes, so in principle one could start
 * with these 8 bytes. At 2^-64 that is not a risk worth a format migration, and
 * the failure mode is a single failed decrypt that falls through to the legacy
 * path anyway.
 */
export const SAFE_STORAGE_MAGIC = Buffer.from("GSsafe1\0", "latin1");

export type StoredCryptoFormat = "safe-storage" | "legacy-machine-id";

export function detectFormat(data: Buffer): StoredCryptoFormat {
	if (data.length < SAFE_STORAGE_MAGIC.length) return "legacy-machine-id";
	return data.subarray(0, SAFE_STORAGE_MAGIC.length).equals(SAFE_STORAGE_MAGIC)
		? "safe-storage"
		: "legacy-machine-id";
}

export function addMagic(ciphertext: Buffer): Buffer {
	return Buffer.concat([SAFE_STORAGE_MAGIC, ciphertext]);
}

export function stripMagic(data: Buffer): Buffer {
	return data.subarray(SAFE_STORAGE_MAGIC.length);
}
