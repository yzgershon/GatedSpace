import { describe, expect, it } from "bun:test";
import { MOBILE_NOTIFICATION_CLIENT_JS } from "./notification-client";

function fixture(hash = "", sessions: unknown[] = []) {
	const opened: Array<{ key: string; provider: string }> = [];
	const errors: string[] = [];
	const replaced: string[] = [];
	const requests: string[] = [];
	let response: Promise<unknown> = Promise.resolve({ sessions });
	const routes = new Function(
		"location",
		"history",
		"api",
		"openSession",
		"fail",
		`var viewGeneration = 0;
		${MOBILE_NOTIFICATION_CLIENT_JS}
		return { fromHash:sessionFromHash, open:openNotifiedSession,
			navigate:function () { viewGeneration++; } };`,
	)(
		{ hash, pathname: "/", search: "" },
		{
			replaceState: (_state: unknown, _title: string, url: string) =>
				replaced.push(url),
		},
		(path: string) => {
			requests.push(path);
			return response;
		},
		(key: string, provider: string) => opened.push({ key, provider }),
		(message: string) => errors.push(message),
	) as {
		fromHash(): { key: string; provider: string | null } | null;
		open(key: string, provider?: string): Promise<void>;
		navigate(): void;
	};
	return {
		...routes,
		opened,
		errors,
		replaced,
		requests,
		respondWith(value: Promise<unknown>) {
			response = value;
		},
	};
}

describe("mobile notification destinations", () => {
	it("keeps old Claude links working through actual session metadata", async () => {
		const page = fixture("#session=legacy%2Fpane", [
			{ key: "legacy/pane", provider: "claude" },
		]);
		const target = page.fromHash();
		expect(target).toEqual({ key: "legacy/pane", provider: null });
		await page.open(target?.key ?? "");
		expect(page.opened).toEqual([{ key: "legacy/pane", provider: "claude" }]);
		expect(page.replaced).toEqual(["/"]);
	});

	it("resolves older untyped Codex notices without falling back to Claude", async () => {
		const page = fixture("", [{ key: "pane-same", provider: "codex" }]);
		await page.open("pane-same");
		expect(page.opened).toEqual([{ key: "pane-same", provider: "codex" }]);
	});

	it("opens explicit Codex deep links directly without waiting for history", async () => {
		const page = fixture("#session=pane-codex&provider=codex");
		const target = page.fromHash();
		expect(target).toEqual({ key: "pane-codex", provider: "codex" });
		await page.open(target?.key ?? "", target?.provider ?? undefined);
		expect(page.requests).toEqual([]);
		expect(page.opened).toEqual([{ key: "pane-codex", provider: "codex" }]);
	});

	it("recognizes provider-prefixed keys without changing session identity", async () => {
		const page = fixture();
		await page.open("codex:pane-123");
		expect(page.opened).toEqual([{ key: "codex:pane-123", provider: "codex" }]);
	});

	it("does not open missing or ambiguous legacy destinations as Claude", async () => {
		const page = fixture("", [
			{ key: "duplicate", provider: "codex" },
			{ key: "duplicate", provider: "claude" },
		]);
		await page.open("missing");
		await page.open("duplicate");
		expect(page.opened).toEqual([]);
		expect(page.errors).toHaveLength(2);
	});

	it("does not interrupt newer navigation after a slow legacy lookup", async () => {
		const page = fixture();
		let resolve: (value: unknown) => void = () => {};
		page.respondWith(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const opening = page.open("old-pane");
		page.navigate();
		resolve({ sessions: [{ key: "old-pane", provider: "codex" }] });
		await opening;
		expect(page.opened).toEqual([]);
		expect(page.errors).toEqual([]);
	});
});
