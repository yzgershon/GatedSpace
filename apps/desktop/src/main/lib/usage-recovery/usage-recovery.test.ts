import { expect, test } from "bun:test";
import { UsageRecovery } from "./usage-recovery";

function fixture() {
	let now = 1_800_000_000_000;
	let reset: number | null = now + 5 * 60 * 60_000;
	let calls = 0;
	let resume: () => Promise<void> = async () => {
		calls++;
	};
	let lookup: () => Promise<number | null> = async () => reset;
	type Timer = ReturnType<typeof setTimeout>;
	const pending = new Map<Timer, { at: number; callback: () => void }>();
	const service = new UsageRecovery(
		{ changed: () => {}, resume: () => resume(), reset: () => lookup() },
		() => now,
		{
			set: ((callback: () => void, delay: number) => {
				const timer = { unref: () => {} } as Timer;
				pending.set(timer, { at: now + delay, callback });
				return timer;
			}) as typeof setTimeout,
			clear: ((timer?: Timer) => {
				if (timer) pending.delete(timer);
			}) as typeof clearTimeout,
		},
	);
	const advance = async (ms: number, sleeping = false) => {
		const target = now + ms;
		for (;;) {
			const next = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
			if (!next || next[1].at > target) break;
			now = sleeping ? target : next[1].at;
			pending.delete(next[0]);
			next[1].callback();
			for (let i = 0; i < 6; i++) await Promise.resolve();
		}
		now = target;
	};
	service.block("pane", "Usage limit reached", reset);
	return {
		service,
		pending,
		advance,
		calls: () => calls,
		now: () => now,
		setReset: (value: number | null) => {
			reset = value;
		},
		setResume: (fn: typeof resume) => {
			resume = fn;
		},
		setLookup: (fn: typeof lookup) => {
			lookup = fn;
		},
	};
}

test("opt-in waits for the real reset and sends exactly once even after a long sleep", async () => {
	const f = fixture();
	await f.advance(60_000);
	expect(f.calls()).toBe(0);
	await f.service.setAutoContinue("pane", true);
	await f.advance(60_000);
	expect(f.calls()).toBe(0);
	await f.advance(6 * 60 * 60_000, true);
	expect(f.calls()).toBe(1);
	expect(f.service.get("pane")).toBeNull();
	await f.advance(24 * 60 * 60_000);
	expect(f.calls()).toBe(1);
});

test("weekly exhaustion postpones the scheduled continuation", async () => {
	const f = fixture();
	f.setReset(f.now() + 7 * 24 * 60 * 60_000);
	await f.service.setAutoContinue("pane", true);
	await f.advance(6 * 60 * 60_000, true);
	expect(f.calls()).toBe(0);
	await f.advance(7 * 24 * 60 * 60_000, true);
	expect(f.calls()).toBe(1);
});

test.each([
	"cancel",
	"clear",
	"forget",
	"dispose",
] as const)("%s prevents scheduled work", async (action) => {
	const f = fixture();
	await f.service.setAutoContinue("pane", true);
	if (action === "dispose") f.service.dispose();
	else f.service[action]("pane");
	await f.advance(24 * 60 * 60_000, true);
	expect(f.calls()).toBe(0);
	expect(f.pending.size).toBe(0);
});

test("cancel during the reset lookup cannot re-arm a timer", async () => {
	const f = fixture();
	let release!: (value: number | null) => void;
	f.setLookup(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const setting = f.service.setAutoContinue("pane", true);
	await f.service.setAutoContinue("pane", false);
	release(f.now() + 1000);
	await setting;
	await f.advance(6 * 60 * 60_000, true);
	expect(f.calls()).toBe(0);
});

test("unknown reset does not invent a five-hour schedule", async () => {
	const f = fixture();
	f.service.clear("pane");
	f.service.block("pane", "Quota reached");
	f.setReset(null);
	await expect(f.service.setAutoContinue("pane", true)).rejects.toThrow(
		"reset time",
	);
	expect(f.service.get("pane")?.autoContinue).toBe(false);
	expect(f.pending.size).toBe(0);
});

test("double click while continuing cannot send twice; a rejection never loops", async () => {
	const f = fixture();
	let calls = 0;
	let fail!: (error: Error) => void;
	f.setResume(() => {
		calls++;
		return new Promise((_, reject) => {
			fail = reject;
		});
	});
	const first = f.service.continue("pane");
	await f.service.continue("pane");
	expect(calls).toBe(1);
	fail(new Error("Account still blocked"));
	await expect(first).rejects.toThrow("still blocked");
	expect(f.service.get("pane")?.error).toContain("still blocked");
	await f.advance(24 * 60 * 60_000, true);
	expect(calls).toBe(1);
});

test("closing during a failed continuation does not resurrect the session", async () => {
	const f = fixture();
	let fail!: (error: Error) => void;
	f.setResume(
		() =>
			new Promise((_, reject) => {
				fail = reject;
			}),
	);
	const run = f.service.continue("pane");
	f.service.forget("pane");
	fail(new Error("Disconnected"));
	await expect(run).rejects.toThrow();
	expect(f.service.get("pane")).toBeNull();
});

test("late reset results from an old incident cannot update a new incident", async () => {
	const f = fixture();
	let release!: (value: number | null) => void;
	f.setLookup(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const lookup = f.service.refresh("pane");
	f.service.clear("pane");
	const latest = f.service.block("pane", "New quota stop", f.now() + 5000);
	release(f.now() + 999_999);
	await lookup;
	expect(f.service.get("pane")).toEqual(latest);
});
