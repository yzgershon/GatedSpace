import { describe, expect, it } from "bun:test";
import {
	attachCopyOnSelect,
	type CopyOnSelectTerminal,
} from "./copy-on-select";

function harness(options: { enabled?: boolean; selection?: string } = {}) {
	let selection = options.selection ?? "hello";
	const selectionListeners: Array<() => void> = [];
	const copied: string[] = [];
	const timers = new Map<number, () => void>();
	let nextHandle = 1;
	const elementListeners = new Map<string, Array<() => void>>();
	const windowListeners = new Map<string, Array<() => void>>();

	const terminal: CopyOnSelectTerminal = {
		onSelectionChange: (listener) => {
			selectionListeners.push(listener);
			// Really remove it, the way xterm's disposable does. A no-op here would
			// make the dispose test pass for the wrong reason.
			return {
				dispose: () => {
					const at = selectionListeners.indexOf(listener);
					if (at !== -1) selectionListeners.splice(at, 1);
				},
			};
		},
		getSelection: () => selection,
		hasSelection: () => selection.length > 0,
	};

	function listenerBag(map: Map<string, Array<() => void>>) {
		return {
			addEventListener: (type: string, fn: () => void) => {
				const list = map.get(type) ?? [];
				list.push(fn);
				map.set(type, list);
			},
			removeEventListener: (type: string, fn: () => void) => {
				const list = map.get(type) ?? [];
				map.set(
					type,
					list.filter((entry) => entry !== fn),
				);
			},
		};
	}

	const element = listenerBag(elementListeners) as unknown as HTMLElement;
	const originalWindow = globalThis.window;
	globalThis.window = listenerBag(
		windowListeners,
	) as unknown as typeof globalThis.window;

	const dispose = attachCopyOnSelect({
		terminal,
		element,
		writeText: (text) => copied.push(text),
		isEnabled: () => options.enabled ?? true,
		schedule: (fn) => {
			const handle = nextHandle++;
			timers.set(handle, fn);
			return handle;
		},
		cancel: (handle) => {
			timers.delete(handle);
		},
	});

	globalThis.window = originalWindow;

	function fire(map: Map<string, Array<() => void>>, type: string) {
		for (const fn of [...(map.get(type) ?? [])]) fn();
	}

	return {
		copied,
		selectAll: () => {
			for (const fn of [...selectionListeners]) fn();
		},
		setSelection: (value: string) => {
			selection = value;
		},
		pointerDown: () => fire(elementListeners, "pointerdown"),
		pointerUp: () => fire(windowListeners, "pointerup"),
		runTimers: () => {
			const pending = [...timers.values()];
			timers.clear();
			for (const fn of pending) fn();
		},
		pendingTimers: () => timers.size,
		dispose,
	};
}

describe("attachCopyOnSelect", () => {
	it("copies once a keyboard selection settles", () => {
		const h = harness();
		h.selectAll();
		h.runTimers();
		expect(h.copied).toEqual(["hello"]);
	});

	it("copies ONCE for a drag, not once per frame", () => {
		// xterm fires selection change on every frame of a drag. Copying each
		// time would hammer the clipboard, which on Windows other apps watch.
		const h = harness();
		h.pointerDown();
		h.selectAll();
		h.selectAll();
		h.selectAll();
		expect(h.copied).toEqual([]);
		h.pointerUp();
		expect(h.copied).toEqual(["hello"]);
	});

	it("does nothing at all when disabled", () => {
		const h = harness({ enabled: false });
		h.selectAll();
		h.runTimers();
		expect(h.copied).toEqual([]);
	});

	it("ignores a whitespace-only selection", () => {
		// Almost always a stray click. Wiping the clipboard with it would be the
		// most irritating possible version of this feature.
		const h = harness({ selection: "   \n  " });
		h.selectAll();
		h.runTimers();
		expect(h.copied).toEqual([]);
	});

	it("drops a queued copy when a new drag starts", () => {
		const h = harness();
		h.selectAll();
		expect(h.pendingTimers()).toBe(1);
		h.pointerDown();
		expect(h.pendingTimers()).toBe(0);
	});

	it("copies on a pointerup that lands outside the terminal", () => {
		// Drags routinely end outside the element; listening there would strand
		// the copy and leave the drag flag stuck on.
		const h = harness();
		h.pointerDown();
		h.selectAll();
		h.pointerUp();
		expect(h.copied).toEqual(["hello"]);
	});

	it("stops after dispose", () => {
		const h = harness();
		h.dispose();
		h.selectAll();
		h.runTimers();
		expect(h.copied).toEqual([]);
	});
});
