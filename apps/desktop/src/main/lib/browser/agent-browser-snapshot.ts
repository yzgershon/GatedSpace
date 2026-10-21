import { randomUUID } from "node:crypto";

// Generate refs in the host: isolated page worlds may lack crypto.randomUUID.
export function browserSnapshotScript() {
	const prefix = `e${randomUUID().slice(0, 8)}-`;
	return `(() => {
 const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
 const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')].filter(visible).slice(0,400);
 const prefix=${JSON.stringify(prefix)};
 globalThis.__gsBrowserElements = new Map(elements.map((e,i) => [prefix+i,e]));
 return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0,24000), elements: elements.map((e,i) => ({ ref: prefix+i, tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), text: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.getAttribute('name') || '').slice(0,200), href: e.getAttribute('href'), type: e.getAttribute('type'), disabled: !!e.disabled })), iframeCount: document.querySelectorAll('iframe').length };
})()`;
}
