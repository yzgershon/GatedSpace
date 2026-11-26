import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type {
	ComputerPointer,
	ComputerUseState,
} from "../../../shared/computer-use";
import { ComputerPointerTracker } from "./pointer-tracker";

test("monitors share one timer; unchanged cursors emit nothing; stopping removes work", () => {
	let state: ComputerUseState = { phase: "off" };
	const source = Object.assign(new EventEmitter(), { get: () => state });
	const callbacks = new Set<() => void>();
	const timers = {
		set: ((fn: () => void) => {
			callbacks.add(fn);
			return fn;
		}) as unknown as typeof setInterval,
		clear: ((fn: () => void) =>
			callbacks.delete(fn)) as unknown as typeof clearInterval,
	};
	let point = { x: 10, y: 20, displayX: -1920, displayY: 0 };
	const tracker = new ComputerPointerTracker(source, () => point, timers);
	const one: (ComputerPointer | null)[] = [],
		two: (ComputerPointer | null)[] = [];
	const off1 = tracker.subscribe((p) => one.push(p)),
		off2 = tracker.subscribe((p) => two.push(p));
	expect(callbacks.size).toBe(0);
	state = { phase: "ready", activity: "Move" };
	source.emit("change");
	expect(callbacks.size).toBe(1);
	for (const fn of callbacks) fn();
	expect(one).toHaveLength(2);
	point = { ...point, x: 12 };
	for (const fn of callbacks) fn();
	expect(two.at(-1)).toMatchObject({ x: 12, displayX: -1920 });
	state = { phase: "stopping" };
	source.emit("change");
	expect(one.at(-1)).toBeNull();
	expect(callbacks.size).toBe(0);
	off1();
	off2();
	expect(source.listenerCount("change")).toBe(0);
});
