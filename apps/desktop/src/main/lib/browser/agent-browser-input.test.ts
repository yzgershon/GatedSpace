import { expect, test } from "bun:test";
import type { WebContents } from "electron";
import { clickBrowserPoint, pressBrowserKey } from "./agent-browser-input";

function fixture(alreadyAttached = false) {
	let attached = alreadyAttached;
	let attaches = 0;
	let detaches = 0;
	const commands: { method: string; args: Record<string, unknown> }[] = [];
	const events: unknown[] = [];
	const wc = {
		isDestroyed: () => false,
		sendInputEvent: (event: unknown) => {
			events.push(event);
		},
		executeJavaScript: async () => {},
		debugger: {
			isAttached: () => attached,
			attach: () => {
				attached = true;
				attaches++;
			},
			detach: () => {
				attached = false;
				detaches++;
			},
			sendCommand: async (method: string, args: Record<string, unknown>) => {
				commands.push({ method, args });
			},
		},
	} as unknown as WebContents;
	return {
		wc,
		commands,
		events,
		attached: () => attached,
		attaches: () => attaches,
		detaches: () => detaches,
	};
}

test("browser click uses CSS coordinates without focusing the desktop window", async () => {
	const f = fixture();
	await clickBrowserPoint(f.wc, { x: 521, y: 83 });
	expect(f.commands.map((c) => c.args)).toEqual([
		{ enabled: true },
		{ type: "mousePressed", x: 521, y: 83, button: "left", clickCount: 1 },
		{ type: "mouseReleased", x: 521, y: 83, button: "left", clickCount: 1 },
	]);
	expect(f.attaches()).toBe(1);
	expect(f.detaches()).toBe(1);
});

test("input retains an already attached debugger", async () => {
	const f = fixture(true);
	await pressBrowserKey(f.wc, "Enter");
	expect(f.attached()).toBe(true);
	expect(f.detaches()).toBe(0);
	expect(f.commands).toEqual([]);
	expect(f.events).toEqual([
		{ type: "keyDown", keyCode: "Enter" },
		{ type: "char", keyCode: "\r" },
		{ type: "keyUp", keyCode: "Enter" },
	]);
});

test("character input targets the guest without CDP's outer-widget keyboard routing", async () => {
	const f = fixture();
	await pressBrowserKey(f.wc, "!");
	expect(f.commands).toEqual([
		{ method: "Emulation.setFocusEmulationEnabled", args: { enabled: true } },
	]);
	expect(f.events).toEqual([
		{ type: "keyDown", keyCode: "!" },
		{ type: "char", keyCode: "!" },
		{ type: "keyUp", keyCode: "!" },
	]);
});

test("unsupported keys never attach or send input", async () => {
	const f = fixture();
	expect(() => pressBrowserKey(f.wc, "Ctrl+Alt+Delete")).toThrow(
		"Unsupported key",
	);
	expect(f.attaches()).toBe(0);
	expect(f.commands).toEqual([]);
});

test("input failures detach but never replay actions; concurrent actions are rejected", async () => {
	const f = fixture();
	let finish = () => {};
	const gate = new Promise<void>((resolve) => {
		finish = resolve;
	});
	let attempts = 0;
	f.wc.debugger.sendCommand = async () => {
		attempts++;
		await gate;
		throw new Error("Navigation interrupted input");
	};
	const first = clickBrowserPoint(f.wc, { x: 10, y: 20 });
	await expect(clickBrowserPoint(f.wc, { x: 20, y: 40 })).rejects.toThrow(
		"still running",
	);
	finish();
	await expect(first).rejects.toThrow("Navigation interrupted");
	expect(attempts).toBe(1);
	expect(f.detaches()).toBe(1);
});
