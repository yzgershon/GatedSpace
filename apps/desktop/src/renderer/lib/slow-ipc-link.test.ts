/**
 * The point of this link is diagnosis, so the tests are mostly about what it
 * must NOT report: a healthy call, a long-lived subscription, or a call the
 * caller hung up on. A noisy detector gets muted, and a muted detector is worse
 * than none — it looks like coverage while telling you nothing.
 */
import { describe, expect, test } from "bun:test";
import { observable } from "@trpc/server/observable";
import { slowIpcLink } from "./slow-ipc-link";

type Op = { id: number; type: string; path: string; input?: unknown };

/**
 * Drive the link directly. `elapsed` controls the clock, so tests assert on a
 * threshold rather than on real time passing.
 */
function run(opts: {
	type?: string;
	path?: string;
	elapsed: number;
	outcome?: "complete" | "error";
	cancel?: boolean;
}) {
	const reports: { message: string; detail: unknown }[] = [];
	let t = 0;
	const link = slowIpcLink({
		thresholdMs: 750,
		now: () => t,
		report: (message, detail) => reports.push({ message, detail }),
	})({} as never);

	const op: Op = {
		id: 1,
		type: opts.type ?? "query",
		path: opts.path ?? "usage.getStats",
	};

	let unsubscribed = false;
	const result = link({
		op: op as never,
		next: () =>
			observable((observer) => {
				// Advance the clock, then settle however the test asked.
				queueMicrotask(() => {
					t = opts.elapsed;
					if (opts.cancel) return;
					if (opts.outcome === "error")
						observer.error(new Error("boom") as never);
					else {
						observer.next({ result: { data: null } } as never);
						observer.complete();
					}
				});
				return () => {
					unsubscribed = true;
				};
			}) as never,
	} as never);

	const sub = (result as ReturnType<typeof observable>).subscribe({
		next: () => {},
		error: () => {},
		complete: () => {},
	});

	return {
		reports,
		cancel: () => sub.unsubscribe(),
		wasUnsubscribed: () => unsubscribed,
	};
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("slowIpcLink", () => {
	test("reports a call slower than the threshold", async () => {
		const h = run({ elapsed: 2000, path: "workspaces.list" });
		await settle();
		expect(h.reports).toHaveLength(1);
		expect(h.reports[0]?.message).toContain("workspaces.list");
		expect(h.reports[0]?.message).toContain("2000ms");
	});

	test("stays silent for a fast call", async () => {
		const h = run({ elapsed: 12 });
		await settle();
		expect(h.reports).toHaveLength(0);
	});

	test("a call exactly at the threshold IS reported", async () => {
		// The guard is `durationMs < threshold`, so the threshold is inclusive:
		// 750ms reports, 749ms does not. Stated explicitly because a test whose
		// name disagrees with its assertion is worse than no test at all.
		const h = run({ elapsed: 750 });
		await settle();
		expect(h.reports).toHaveLength(1);

		const fast = run({ elapsed: 749 });
		await settle();
		expect(fast.reports).toHaveLength(0);
	});

	test("a slow call that FAILED is still reported, and marked", async () => {
		// An error after two seconds is the most interesting case there is — it
		// means something tried and gave up, which a success-only detector misses.
		const h = run({ elapsed: 3000, outcome: "error" });
		await settle();
		expect(h.reports).toHaveLength(1);
		expect(h.reports[0]?.message).toContain("(failed)");
	});

	test("subscriptions are never reported", async () => {
		// claudeSession.stream stays open for the life of a pane; timing it would
		// report every healthy session as the slowest thing in the app.
		const h = run({ type: "subscription", elapsed: 60_000 });
		await settle();
		expect(h.reports).toHaveLength(0);
	});

	test("a cancelled call is not counted as slow", async () => {
		// Hanging up is the caller's choice, not a stall to blame on the boundary.
		const h = run({ elapsed: 5000, cancel: true });
		h.cancel();
		await settle();
		expect(h.reports).toHaveLength(0);
		expect(h.wasUnsubscribed()).toBe(true);
	});

	test("one call reports at most once", async () => {
		const h = run({ elapsed: 4000 });
		await settle();
		await settle();
		expect(h.reports).toHaveLength(1);
	});
});
