import type { WebContents } from "electron";
import {
	containBrowserTab,
	preserveBrowserHostFocus,
} from "./agent-browser-focus";
import { browserDevtoolsPoint } from "./browser-preview";

const busy = new WeakSet<WebContents>();

/** Chromium input targets the guest directly, without stealing desktop focus. */
export async function browserInput(
	wc: WebContents,
	run: (
		send: (method: string, args: Record<string, unknown>) => Promise<unknown>,
	) => Promise<void>,
) {
	if (busy.has(wc))
		throw new Error("A browser action is still running. Wait for its result.");
	busy.add(wc);
	let attached = false;
	let releaseFocus: (() => Promise<void>) | undefined;
	try {
		releaseFocus = await preserveBrowserHostFocus(wc);
		if (!wc.debugger.isAttached()) {
			wc.debugger.attach("1.3");
			attached = true;
			await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
				enabled: true,
			});
		}
		await run((method, args) => wc.debugger.sendCommand(method, args));
	} finally {
		// Never detach a debugger owned by another feature. Never retry input:
		// navigation/disconnection can happen after the click already succeeded.
		try {
			if (attached && !wc.isDestroyed() && wc.debugger.isAttached())
				wc.debugger.detach();
		} finally {
			busy.delete(wc);
			await releaseFocus?.();
		}
	}
}

export function clickBrowserPoint(
	wc: WebContents,
	point: { x: number; y: number },
) {
	return browserInput(wc, async (send) => {
		const displayed = browserDevtoolsPoint(wc, point);
		await send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...displayed,
			button: "left",
			clickCount: 1,
		});
		await send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...displayed,
			button: "left",
			clickCount: 1,
		});
	});
}

const keyCodes: Record<string, string> = {
	Enter: "Enter",
	Tab: "Tab",
	Escape: "Escape",
	Backspace: "Backspace",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
};
export function pressBrowserKey(wc: WebContents, key: string) {
	if (!Object.hasOwn(keyCodes, key) && key.length !== 1)
		throw new Error("Unsupported key.");
	return browserInput(wc, async () => {
		// CDP key events resolve the outer page's focused widget for an embedded
		// webview. That can type into the user's composer! Electron's direct guest
		// event path targets this widget, with virtual focus enabled above. It does
		// not use Windows input, focus a window, or move the physical cursor.
		const keyCode = keyCodes[key] ?? key;
		const releaseTab = key === "Tab" ? await containBrowserTab(wc) : undefined;
		try {
			wc.sendInputEvent({ type: "keyDown", keyCode });
			if (key.length === 1 || key === "Enter")
				wc.sendInputEvent({
					type: "char",
					keyCode: key === "Enter" ? "\r" : key,
				});
			wc.sendInputEvent({ type: "keyUp", keyCode });
			// Let the guest process its events before releasing virtual focus.
			await wc.executeJavaScript("void 0");
		} finally {
			await releaseTab?.();
		}
	});
}
