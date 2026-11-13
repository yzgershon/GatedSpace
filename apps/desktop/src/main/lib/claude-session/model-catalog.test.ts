import { describe, expect, test } from "bun:test";
import { ClaudeModelCatalog } from "./model-catalog";

describe("Claude model capability handshake", () => {
	const setup = (timeout = 50) => {
		const writes: unknown[] = [];
		const catalog = new ClaudeModelCatalog(
			(value) => writes.push(value),
			timeout,
		);
		const respond = (models: unknown) =>
			catalog.handle({
				type: "control_response",
				response: {
					subtype: "success",
					request_id: (writes[0] as { request_id: string }).request_id,
					response: { models },
				},
			});
		return { writes, catalog, respond };
	};

	test("shares one no-prompt handshake and keeps version labels from the runtime", async () => {
		const { writes, catalog, respond } = setup();
		const first = catalog.read();
		expect(catalog.read()).toBe(first);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({
			type: "control_request",
			request: { subtype: "initialize" },
		});
		respond([
			{
				value: "fable",
				displayName: "Fable 5.2",
				resolvedModel: "claude-fable-5-2",
				description: "For your toughest challenges",
			},
		]);
		expect(await first).toEqual([
			{
				id: "fable",
				label: "Fable 5.2",
				resolvedModel: "claude-fable-5-2",
				description: "For your toughest challenges",
			},
		]);
		expect(catalog.read()).toBe(first);
	});

	test("does not consume permission requests, turn results, or unrelated control replies", async () => {
		const { catalog, respond } = setup();
		const pending = catalog.read();
		for (const event of [
			{ type: "result" },
			{ type: "control_request", request_id: "permission" },
			{ type: "control_response", response: { request_id: "interrupt" } },
		]) {
			expect(catalog.handle(event)).toBe(false);
		}
		respond([]);
		expect(await pending).toEqual([]);
	});

	test("times out without retrying or interrupting the session", async () => {
		const { catalog, writes } = setup(5);
		expect(await catalog.read()).toEqual([]);
		expect(await catalog.read()).toEqual([]);
		expect(writes).toHaveLength(1);
	});

	test("settles a pending read on disconnect; another process gets its own catalog", async () => {
		const a = setup();
		const pending = a.catalog.read();
		a.catalog.dispose();
		expect(await pending).toEqual([]);
		const b = setup();
		const other = b.catalog.read();
		b.respond([{ value: "sonnet", displayName: "Sonnet account B" }]);
		expect((await other)[0]?.label).toBe("Sonnet account B");
		expect(await a.catalog.read()).toEqual([]);
	});

	test("older runtimes rejecting initialize leave the composer usable", async () => {
		const { catalog, writes } = setup();
		const pending = catalog.read();
		catalog.handle({
			type: "control_response",
			response: {
				subtype: "error",
				request_id: (writes[0] as { request_id: string }).request_id,
				error: "unsupported",
			},
		});
		expect(await pending).toEqual([]);
	});
});
