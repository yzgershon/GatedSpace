import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign,
} from "node:crypto";

/**
 * The signing identity the phone's push service checks before it will deliver
 * anything.
 *
 * Web Push does not let a server push to a phone just because it holds a
 * subscription URL — it must prove it is the same party the subscription was
 * created for, by signing a short-lived token with a key whose public half was
 * given at subscribe time. That is all VAPID is here.
 *
 * The key pair is generated once and kept. Regenerating it would silently
 * invalidate every subscription already on a phone: pushes would be rejected by
 * the push service with no error anyone sees, and notifications would simply
 * stop arriving.
 */
export interface VapidKeys {
	publicKey: string;
	privateKey: string;
}

function toBase64Url(buffer: Buffer): string {
	return buffer.toString("base64url");
}

export function generateVapidKeys(): VapidKeys {
	const { publicKey, privateKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
	const privateJwk = privateKey.export({ format: "jwk" }) as JsonWebKey;
	return {
		// The uncompressed point (65 bytes, leading 0x04) is the form the browser
		// expects for applicationServerKey — NOT the DER/SPKI encoding, which it
		// rejects outright.
		publicKey: toBase64Url(rawPublicPoint(publicJwk)),
		privateKey: privateJwk.d ?? "",
	};
}

function rawPublicPoint(jwk: JsonWebKey): Buffer {
	return Buffer.concat([
		Buffer.from([0x04]),
		Buffer.from(jwk.x ?? "", "base64url"),
		Buffer.from(jwk.y ?? "", "base64url"),
	]);
}

/**
 * The `Authorization` header for one push.
 *
 * Scoped to the ORIGIN of the push endpoint, not the endpoint itself, and
 * short-lived. A token that never expired would keep working for whoever
 * happened to read it out of a log.
 */
export function buildVapidAuthorization({
	audience,
	subject,
	keys,
	expiresAt,
}: {
	audience: string;
	subject: string;
	keys: VapidKeys;
	expiresAt: number;
}): string {
	const header = toBase64Url(
		Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })),
	);
	const payload = toBase64Url(
		Buffer.from(
			JSON.stringify({ aud: audience, exp: expiresAt, sub: subject }),
		),
	);
	const signingInput = `${header}.${payload}`;

	const privateKey = createPrivateKey({
		key: {
			kty: "EC",
			crv: "P-256",
			d: keys.privateKey,
			...publicCoordinates(keys.publicKey),
		},
		format: "jwk",
	});

	// JWS wants the raw r||s pair. The default DER encoding is a valid ECDSA
	// signature and is silently rejected by every push service.
	const signature = sign("sha256", Buffer.from(signingInput), {
		key: privateKey,
		dsaEncoding: "ieee-p1363",
	});

	return `vapid t=${signingInput}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

function publicCoordinates(publicKey: string): { x: string; y: string } {
	const raw = Buffer.from(publicKey, "base64url");
	return {
		x: toBase64Url(raw.subarray(1, 33)),
		y: toBase64Url(raw.subarray(33, 65)),
	};
}

/** The origin a push endpoint belongs to — the `aud` of the token. */
export function audienceOf(endpoint: string): string | null {
	try {
		return new URL(endpoint).origin;
	} catch {
		return null;
	}
}

/** Round-trips a stored public key back into a usable key object. */
export function publicKeyFromRaw(publicKey: string) {
	return createPublicKey({
		key: { kty: "EC", crv: "P-256", ...publicCoordinates(publicKey) },
		format: "jwk",
	});
}
