import { describe, expect, it } from "bun:test";
import { createVerify, verify } from "node:crypto";
import {
	audienceOf,
	buildVapidAuthorization,
	generateVapidKeys,
	publicKeyFromRaw,
} from "./vapid";

/**
 * Every mistake available here fails the same way in production: the push
 * service returns 401 and nothing arrives, with no error on this machine and
 * nothing on the phone to notice. None of it is observable without a real
 * subscription, so it is all checked here instead.
 */

describe("the key pair", () => {
	it("hands out the raw point the browser wants, not DER", () => {
		// applicationServerKey must be the 65-byte uncompressed point. A SPKI
		// encoding is a perfectly valid public key and is rejected outright.
		const { publicKey } = generateVapidKeys();
		const raw = Buffer.from(publicKey, "base64url");
		expect(raw.length).toBe(65);
		expect(raw[0]).toBe(0x04);
	});

	it("round-trips back into a usable key", () => {
		expect(() => publicKeyFromRaw(generateVapidKeys().publicKey)).not.toThrow();
	});

	it("is base64url, not base64", () => {
		// "+" and "/" in an applicationServerKey break the browser's decode.
		const { publicKey } = generateVapidKeys();
		expect(publicKey).not.toContain("+");
		expect(publicKey).not.toContain("/");
		expect(publicKey).not.toContain("=");
	});
});

describe("the authorization header", () => {
	const keys = generateVapidKeys();
	const header = buildVapidAuthorization({
		audience: "https://fcm.googleapis.com",
		subject: "https://example.test",
		keys,
		expiresAt: 2_000_000_000,
	});

	it("is the vapid scheme with both parts", () => {
		expect(header.startsWith("vapid t=")).toBe(true);
		expect(header).toContain(", k=");
	});

	it("advertises the same key it signed with", () => {
		expect(header.endsWith(`, k=${keys.publicKey}`)).toBe(true);
	});

	it("carries the audience and expiry the push service checks", () => {
		const token = header.slice("vapid t=".length).split(", k=")[0] ?? "";
		const payload = JSON.parse(
			Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
		);
		expect(payload.aud).toBe("https://fcm.googleapis.com");
		expect(payload.exp).toBe(2_000_000_000);
		expect(payload.sub).toBe("https://example.test");
	});

	it("signs in the raw r||s form JWS requires, not DER", () => {
		// The default node encoding is DER, which is a valid ECDSA signature and
		// is rejected by every push service. Verifying with ieee-p1363 is the
		// only thing that distinguishes them.
		const token = header.slice("vapid t=".length).split(", k=")[0] ?? "";
		const parts = token.split(".");
		const signingInput = `${parts[0]}.${parts[1]}`;
		const signature = Buffer.from(parts[2] ?? "", "base64url");

		expect(signature.length).toBe(64);
		expect(
			verify(
				"sha256",
				Buffer.from(signingInput),
				{ key: publicKeyFromRaw(keys.publicKey), dsaEncoding: "ieee-p1363" },
				signature,
			),
		).toBe(true);
	});

	it("does not verify as DER, proving the encoding is deliberate", () => {
		const token = header.slice("vapid t=".length).split(", k=")[0] ?? "";
		const parts = token.split(".");
		const der = createVerify("sha256");
		der.update(`${parts[0]}.${parts[1]}`);
		expect(
			der.verify(
				publicKeyFromRaw(keys.publicKey),
				Buffer.from(parts[2] ?? "", "base64url"),
			),
		).toBe(false);
	});
});

describe("the audience", () => {
	it("is the origin, not the whole endpoint", () => {
		// Signing for the full path yields a token the service rejects.
		expect(audienceOf("https://fcm.googleapis.com/fcm/send/abc123")).toBe(
			"https://fcm.googleapis.com",
		);
	});

	it("refuses a subscription that is not a URL", () => {
		expect(audienceOf("not a url")).toBe(null);
	});
});
