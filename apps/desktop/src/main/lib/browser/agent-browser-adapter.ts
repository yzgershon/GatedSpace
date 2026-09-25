import { setTimeout as delay } from "node:timers/promises";
import {
	agentBrowserService,
	type BrowserAdapter,
} from "./agent-browser-service";
import { browserManager } from "./browser-manager";
import { browserInputPoint } from "./browser-preview";

// An isolated world keeps our element map separate from scripts on the website.
const WORLD = 1005;
const SNAPSHOT = `(() => {
 const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
 const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')].filter(visible).slice(0,400);
 const prefix='e'+crypto.randomUUID().slice(0,8)+'-';
 globalThis.__gsBrowserElements = new Map(elements.map((e,i) => [prefix+i,e]));
 return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0,24000), elements: elements.map((e,i) => ({ ref: prefix+i, tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), text: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.getAttribute('name') || '').slice(0,200), href: e.getAttribute('href'), type: e.getAttribute('type'), disabled: !!e.disabled })), iframeCount: document.querySelectorAll('iframe').length };
})()`;
function wcFor(paneId: string) {
	const wc = browserManager.getWebContents(paneId);
	if (!wc)
		throw new Error(
			"Browser tab is closed. Use browser_open to open it again.",
		);
	return wc;
}
async function script(paneId: string, code: string): Promise<unknown> {
	return wcFor(paneId).executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
}
function element(ref: string | undefined) {
	if (!ref || !/^e[0-9a-f]{8}-\d+$/.test(ref))
		throw new Error("Supply an element ref from browser_snapshot.");
	return `const e = globalThis.__gsBrowserElements?.get(${JSON.stringify(ref)}); if (!e?.isConnected) throw new Error('Stale element ref; take a new snapshot.');`;
}
async function snapshot(paneId: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(await script(paneId, SNAPSHOT)),
			},
		],
	};
}
const adapter: BrowserAdapter = {
	async ready(paneId) {
		const until = Date.now() + 15_000;
		while (Date.now() < until) {
			const wc = browserManager.getWebContents(paneId);
			if (wc && !wc.isLoadingMainFrame()) return;
			await delay(50);
		}
		throw new Error(
			"Browser tab has not finished opening. Retry the snapshot shortly.",
		);
	},
	async run(tool, paneId, input) {
		const wc = wcFor(paneId);
		if (tool === "browser_open") {
			if (wc.getURL() !== input.url) await wc.loadURL(input.url as string);
		} else if (tool === "browser_screenshot") {
			const image = await wc.capturePage();
			if (image.isEmpty())
				throw new Error(
					"The browser is not visible. Open this workspace and retry.",
				);
			return {
				content: [
					{
						type: "image",
						mimeType: "image/png",
						data: image.toPNG().toString("base64"),
					},
				],
			};
		} else if (tool === "browser_console") {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							browserManager.getConsoleLogs(paneId).slice(-100),
						),
					},
				],
			};
		} else if (tool === "browser_click") {
			const pagePoint = (await script(
				paneId,
				`(() => { ${element(input.ref)} e.scrollIntoView({block:'center',inline:'center'}); const r=e.getBoundingClientRect(); const x=r.x+r.width/2, y=r.y+r.height/2; const hit=document.elementFromPoint(x,y); if (!hit || (!e.contains(hit) && !hit.contains(e))) throw new Error('Element is covered; take a new snapshot.'); return { x:Math.round(x), y:Math.round(y) }; })()`,
			)) as { x: number; y: number };
			const point = browserInputPoint(wc, pagePoint);
			wc.sendInputEvent({
				type: "mouseDown",
				...point,
				button: "left",
				clickCount: 1,
			});
			wc.sendInputEvent({
				type: "mouseUp",
				...point,
				button: "left",
				clickCount: 1,
			});
		} else if (tool === "browser_fill") {
			if (input.text === undefined) throw new Error("Supply text to fill.");
			await script(
				paneId,
				`(() => { ${element(input.ref)} if (e.disabled || e.readOnly) throw new Error('Field is not editable.'); e.focus(); const value=${JSON.stringify(input.text)}; if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) { if (e.type==='file' || e.type==='password') throw new Error('Use the browser directly for files or passwords.'); const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value); } else if (e.isContentEditable) e.textContent=value; else throw new Error('Element is not an editable text field.'); e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`,
			);
		} else if (tool === "browser_press") {
			const key = input.key ?? "";
			if (
				!/^(Enter|Tab|Escape|Backspace|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|.)$/.test(
					key,
				)
			)
				throw new Error("Unsupported key.");
			wc.sendInputEvent({ type: "keyDown", keyCode: key });
			if (key.length === 1) wc.sendInputEvent({ type: "char", keyCode: key });
			wc.sendInputEvent({ type: "keyUp", keyCode: key });
		} else if (tool === "browser_scroll") {
			const direction = input.direction ?? "down";
			await script(
				paneId,
				`window.scrollBy({left:${direction === "left" ? "-innerWidth*.8" : direction === "right" ? "innerWidth*.8" : "0"},top:${direction === "up" ? "-innerHeight*.8" : direction === "down" ? "innerHeight*.8" : "0"},behavior:'instant'})`,
			);
		}
		if (tool !== "browser_snapshot") {
			await delay(120);
			await adapter.ready(paneId);
		}
		return snapshot(paneId);
	},
};
export function installAgentBrowserAdapter() {
	agentBrowserService.adapter = adapter;
}
