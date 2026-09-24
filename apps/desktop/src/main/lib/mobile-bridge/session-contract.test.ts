import { describe, expect, it } from "bun:test";
import { messagePage, promptSchema, RequestLedger } from "./session-contract";

describe("mobile session safety and pagination", () => {
	it("joins a retried send instead of sending twice", async () => {
		const ledger = new RequestLedger();
		let calls = 0;
		const send = async () => {
			calls++;
			await Bun.sleep(2);
			return { ok: true };
		};
		const results = await Promise.all([
			ledger.run("r", "same", send),
			ledger.run("r", "same", send),
		]);
		expect(calls).toBe(1);
		expect(results[0]).toEqual(results[1]);
		await expect(ledger.run("r", "different", send)).rejects.toThrow(
			"different message",
		);
		expect(calls).toBe(1);
	});
	it("keeps accepted failures associated with their request so retries cannot duplicate uncertain work", async () => {
		const ledger = new RequestLedger();
		let calls = 0;
		const send = async () => {
			calls++;
			throw new Error("Connection lost");
		};
		await expect(ledger.run("r", "same", send)).rejects.toThrow();
		await expect(ledger.run("r", "same", send)).rejects.toThrow();
		expect(calls).toBe(1);
	});
	it("reaches history beyond the old 4,000-event ceiling without duplicates", () => {
		const all = Array.from({ length: 5_100 }, (_, n) => ({
			id: String(n),
			kind: "user" as const,
			text: `Prompt ${n}`,
		}));
		let page = messagePage(all);
		const read = [...page.messages];
		while (page.hasEarlier) {
			page = messagePage(all, read[0]?.id);
			read.unshift(...page.messages);
		}
		expect(read).toEqual(all);
		expect(new Set(read.map((m) => m.id)).size).toBe(5_100);
		expect(() => messagePage(all, "missing")).toThrow("position changed");
	});
	it("accepts image-only prompts but rejects invalid or oversized attachments", () => {
		const requestId = crypto.randomUUID();
		expect(
			promptSchema.safeParse({
				requestId,
				images: [{ mediaType: "image/png", data: "YQ==" }],
			}).success,
		).toBe(true);
		for (const images of [
			[{ mediaType: "image/svg+xml", data: "YQ==" }],
			[{ mediaType: "image/png", data: "file:///secret" }],
			[{ mediaType: "image/png", data: "a".repeat(5_000_004) }],
		]) {
			expect(promptSchema.safeParse({ requestId, images }).success).toBe(false);
		}
		expect(promptSchema.safeParse({ requestId, text: "   " }).success).toBe(
			false,
		);
	});
});
