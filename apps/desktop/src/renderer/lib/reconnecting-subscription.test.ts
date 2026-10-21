import { expect, test } from "bun:test";
import { reconnectingSubscription } from "./reconnecting-subscription";

test("reconnects after an IPC error, delivers replay, and cancels retries on unmount", async () => {
	let connects = 0,
		closes = 0;
	let fail = () => {};
	const received: number[] = [];
	const stop = reconnectingSubscription<number>(
		(observer) => {
			connects++;
			fail = () => observer.onError(new Error("IPC disconnected"));
			if (connects > 1) observer.onData(42);
			return {
				unsubscribe: () => {
					closes++;
				},
			};
		},
		(value) => {
			received.push(value);
		},
		5,
	);
	fail();
	fail();
	await new Promise((r) => setTimeout(r, 25));
	expect(connects).toBe(2);
	expect(closes).toBe(1);
	expect(received).toEqual([42]);
	fail();
	stop();
	await new Promise((r) => setTimeout(r, 25));
	expect(connects).toBe(2);
	expect(closes).toBe(2);
});

test("replays a pending request when its asynchronous acknowledgement fails", async () => {
	let connects = 0;
	const received: number[] = [];
	const stop = reconnectingSubscription<number>(
		(observer) => {
			connects++;
			observer.onData(42);
			return { unsubscribe() {} };
		},
		async (value) => {
			received.push(value);
			if (received.length === 1)
				throw new Error("Acknowledgement disconnected");
		},
		5,
	);
	await new Promise((resolve) => setTimeout(resolve, 25));
	stop();
	expect(connects).toBe(2);
	expect(received).toEqual([42, 42]);
});
