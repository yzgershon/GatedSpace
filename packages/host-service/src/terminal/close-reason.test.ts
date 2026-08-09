import { describe, expect, it } from "bun:test";
import { truncateCloseReason } from "./terminal.ts";

// RFC 6455 caps a close frame's reason at 123 bytes and `ws` throws above it.
// When that throw happened during attach the socket was left half-open: the
// renderer had already taken `{type:"error"}` (which sets `_terminated` and
// cancels auto-reconnect) but never saw a `close`, so the pane stayed blank
// and stuck in "connecting" forever. Verified against a live host 2026-08-09.
const LIMIT = 123;
const byteLength = (s: string) => new TextEncoder().encode(s).length;

describe("truncateCloseReason", () => {
	it("leaves a short reason untouched", () => {
		expect(truncateCloseReason("Session disposed")).toBe("Session disposed");
	});

	it("keeps a reason that sits exactly on the limit", () => {
		const exact = "a".repeat(LIMIT);
		expect(truncateCloseReason(exact)).toBe(exact);
	});

	it("bounds the workspace-mismatch error that actually blew the limit", () => {
		// 160 bytes with real uuids — the message measured in production.
		const reason =
			'Terminal session "74833e5e-1107-4a45-a05a-ca7669e2d4e1" belongs to ' +
			'workspace "76fb8461-d88a-4ae2-bf7a-788513d98d6c", not ' +
			'"00000000-1111-2222-3333-444444444444".';
		expect(byteLength(reason)).toBeGreaterThan(LIMIT);
		expect(byteLength(truncateCloseReason(reason))).toBeLessThanOrEqual(LIMIT);
		// Still says enough to identify the failure.
		expect(truncateCloseReason(reason)).toContain("Terminal session");
	});

	it("counts BYTES, not characters, so multi-byte text can't overflow", () => {
		// 120 emoji = 480 UTF-8 bytes. A char-based clamp would pass 123 of
		// them straight through and still throw.
		const reason = "🙂".repeat(120);
		expect(byteLength(truncateCloseReason(reason))).toBeLessThanOrEqual(LIMIT);
	});

	it("never splits a codepoint", () => {
		const reason = "🙂".repeat(120);
		const out = truncateCloseReason(reason);
		// A split surrogate/continuation byte would decode to U+FFFD.
		expect(out).not.toContain("�");
		expect(
			new TextDecoder("utf-8", { fatal: true }).decode(
				new TextEncoder().encode(out),
			),
		).toBe(out);
	});
});
