import { describe, expect, it } from "bun:test";
import { suppressMiddleClickAutoscroll } from "./suppress-middle-click-autoscroll";

function harness() {
	const listeners: Array<{
		type: string;
		fn: (event: Event) => void;
		capture: boolean;
	}> = [];

	const target = {
		addEventListener: (
			type: string,
			fn: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		) => {
			listeners.push({
				type,
				fn: fn as (event: Event) => void,
				capture:
					typeof options === "boolean" ? options : Boolean(options?.capture),
			});
		},
		removeEventListener: (
			type: string,
			fn: EventListenerOrEventListenerObject,
		) => {
			const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
			if (at !== -1) listeners.splice(at, 1);
		},
	};

	const dispose = suppressMiddleClickAutoscroll(target);

	function fire(button: number) {
		let prevented = false;
		const event = {
			button,
			preventDefault: () => {
				prevented = true;
			},
		} as unknown as Event;
		for (const l of [...listeners]) {
			if (l.type === "mousedown") l.fn(event);
		}
		return prevented;
	}

	return { fire, dispose, listeners };
}

describe("suppressMiddleClickAutoscroll", () => {
	it("prevents the default on middle mousedown", () => {
		// This is what starts Chromium's autoscroll and leaves a scroll puck on
		// the cursor.
		expect(harness().fire(1)).toBe(true);
	});

	it("leaves left and right alone", () => {
		// Preventing left would break every click in the app; right would break
		// context menus.
		const h = harness();
		expect(h.fire(0)).toBe(false);
		expect(h.fire(2)).toBe(false);
	});

	it("listens on the capture phase", () => {
		// Autoscroll begins on mousedown, so a bubble-phase listener can be beaten
		// by anything that stops propagation on the way up.
		expect(harness().listeners[0]?.capture).toBe(true);
	});

	it("stops after dispose", () => {
		const h = harness();
		h.dispose();
		expect(h.listeners).toHaveLength(0);
		expect(h.fire(1)).toBe(false);
	});
});
