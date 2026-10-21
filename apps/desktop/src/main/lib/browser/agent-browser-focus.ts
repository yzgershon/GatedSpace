import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";

const WORLD = 1006;

/** Keep the native Tab key from traversing out of a guest into the user's app. */
export async function containBrowserTab(wc: WebContents) {
	await wc.executeJavaScriptInIsolatedWorld(WORLD, [
		{
			code: `(() => {
		globalThis.__gsBrowserTabBoundary?.();
		const onKey = event => {
			if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
			let active = document.activeElement;
			while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
			const collect = root => [...root.querySelectorAll('*')].flatMap(e => [e, ...(e.shadowRoot ? collect(e.shadowRoot) : [])]);
			const candidates = collect(document).filter(e => e.tabIndex >= 0 && !e.matches(':disabled') && !e.closest('[inert]') &&
				e.getClientRects().length && getComputedStyle(e).visibility === 'visible');
			// Native tab order: positive tabindex first, then document order.
			candidates.sort((a,b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
			if (!candidates.length || active === candidates.at(-1)) {
				event.preventDefault();
				candidates[0]?.focus({preventScroll:true});
			}
		};
		const cleanup = () => { clearTimeout(timer); document.removeEventListener('keydown',onKey,true); delete globalThis.__gsBrowserTabBoundary; };
		const timer = setTimeout(cleanup,5000);
		document.addEventListener('keydown',onKey,true);
		globalThis.__gsBrowserTabBoundary = cleanup;
	})()`,
		},
	]);
	return async () => {
		if (!wc.isDestroyed())
			await wc.executeJavaScriptInIsolatedWorld(WORLD, [
				{ code: "globalThis.__gsBrowserTabBoundary?.()" },
			]);
	};
}

/** Guest CDP mouse input can focus its host <webview>, even in a background window. */
export async function preserveBrowserHostFocus(
	wc: WebContents,
): Promise<() => Promise<void>> {
	const host = wc.hostWebContents;
	if (!host || host.isDestroyed()) return async () => {};
	const token = randomUUID();
	await host.executeJavaScriptInIsolatedWorld(WORLD, [
		{
			code: `(() => {
			const guest = document.querySelector('webview[data-browser-contents-id="${wc.id}"]');
			if (!guest) throw new Error('Browser focus guard is not ready. Retry the action.');
			// One guard per host also covers overlapping actions in different tabs.
			let state = globalThis.__gsBrowserFocusGuard;
			if (!state) {
				state = { actions:new Map(), previous:document.activeElement };
				state.isAgentGuest = (target) => [...state.actions.values()].some(a=>a.guest===target);
				state.restore = () => {
					const active = document.activeElement;
					if (!state.isAgentGuest(active) || state.previous === active) return;
					if (state.previous?.isConnected && typeof state.previous.focus === 'function')
						state.previous.focus({preventScroll:true});
					if (document.activeElement === active) active.blur();
				};
				state.protect = (event) => {
					if (!state.isAgentGuest(event.target)) {
						state.previous = event.target;
						return;
					}
					if (state.previous === event.target) return;
					// Stop guest-focus forwarding before it changes shortcut routing.
					event.stopImmediatePropagation();
					state.restore();
				};
				document.addEventListener('focus', state.protect, true);
				globalThis.__gsBrowserFocusGuard = state;
			}
			const cleanup = () => {
				// Hidden Electron hosts can update activeElement without a focus event.
				state.restore();
				clearTimeout(timer);
				state.actions.delete(${JSON.stringify(token)});
				if (!state.actions.size) {
					document.removeEventListener('focus', state.protect, true);
					delete globalThis.__gsBrowserFocusGuard;
				}
			};
			const timer = setTimeout(cleanup, 30000);
			state.actions.set(${JSON.stringify(token)}, {guest,cleanup});
		})()`,
		},
	]);
	return async () => {
		if (!host.isDestroyed())
			await host.executeJavaScriptInIsolatedWorld(WORLD, [
				{
					code: `globalThis.__gsBrowserFocusGuard?.actions.get(${JSON.stringify(token)})?.cleanup()`,
				},
			]);
	};
}
