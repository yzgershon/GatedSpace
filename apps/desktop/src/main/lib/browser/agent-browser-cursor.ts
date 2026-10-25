/** A reusable page-local pointer. No system input, focus, or agent settings. */
export function browserCursorScript(
	point: { x: number; y: number } | null,
	session?: string,
) {
	const label = session?.startsWith("claude:") ? "Claude" : "Codex";
	const color = label === "Claude" ? "#e5a07b" : "#5de4c7";
	return `(() => { try {
  const point = ${JSON.stringify(point)} ?? (() => {
   const e = document.activeElement;
   if (!e || e === document.body || e === document.documentElement) return null;
   const r = e.getBoundingClientRect();
   return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null;
  })();
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  let cursor = globalThis.__gsBrowserCursor;
  if (!cursor?.host?.isConnected) {
   cursor?.remove?.();
   const host = document.createElement('div');
   host.setAttribute('data-gatedspace-agent-cursor', '');
   host.setAttribute('aria-hidden', 'true');
   host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;contain:layout style!important;';
   const shadow = host.attachShadow({mode:'closed'});
   shadow.innerHTML = '<style>:host,*{pointer-events:none!important}.pointer{position:absolute;left:0;top:0}.label{position:absolute;top:25px;left:17px;white-space:nowrap;font:600 10px/16px system-ui,sans-serif;letter-spacing:.1px;padding:1px 6px;border:1px solid #ffffff26;border-radius:5px;background:#20232deb;color:var(--agent);box-shadow:0 1px 4px #0004}.arrow{display:block;filter:drop-shadow(0 1px 1px #0008)}</style><div class="pointer"><svg class="arrow" width="25" height="31" viewBox="0 0 25 31"><defs><linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f8fcff"/><stop offset=".22" stop-color="#8297a9"/><stop offset=".4" stop-color="#f1f7ff"/><stop offset=".65" stop-color="#435564"/><stop offset=".85" stop-color="#e9f7ff"/><stop offset="1" stop-color="#819cae"/></linearGradient><linearGradient id="face" x1="0" y1="0" x2="1" y2=".8"><stop stop-color="#f8fbff"/><stop offset=".48" stop-color="#bac9d6"/><stop offset=".52" stop-color="#647988"/><stop offset="1" stop-color="#e1ecf4"/></linearGradient></defs><path d="M2 2L22 17.7Q23 19 21 19.3L14.7 20L18.3 26.6Q18.8 27.5 17.8 28L14.8 29.3Q13.9 29.7 13.4 28.7L9.8 22L5 26.2Q3.4 27.5 3.3 25.5Z" fill="url(#rim)" stroke="#263c4a" stroke-width="1.1" stroke-linejoin="round"/><path d="M4.3 5.7L19.2 17.4L11.5 18.9L15.7 26.5L14.7 27L9.5 19.4L5 23.3Z" fill="url(#face)"/><path d="M4.3 5.7L9.5 19.4L19.2 17.4" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width=".7"/><path d="M4 12L4.6 24.3" stroke="var(--agent)" stroke-width=".9" opacity=".8"/></svg><span class="label"></span></div>';
   document.documentElement.appendChild(host);
   cursor = {host, pointer:shadow.querySelector('.pointer'), label:shadow.querySelector('.label'), timer:null};
   cursor.remove = () => { clearTimeout(cursor.timer); host.remove(); if (globalThis.__gsBrowserCursor === cursor) delete globalThis.__gsBrowserCursor; };
   globalThis.__gsBrowserCursor = cursor;
  }
  clearTimeout(cursor.timer);
  const x = Math.max(0, Math.min(innerWidth-25, point.x-2));
  const y = Math.max(0, Math.min(innerHeight-31, point.y-2));
  cursor.pointer.style.transform = 'translate3d('+x+'px,'+y+'px,0)';
  cursor.pointer.style.setProperty('--agent', '${color}');
  cursor.label.textContent = '${label}';
  cursor.label.style.left = x > innerWidth-90 ? 'auto' : '17px';
  cursor.label.style.right = x > innerWidth-90 ? '8px' : 'auto';
  cursor.label.style.top = y > innerHeight-55 ? '-20px' : '25px';
  cursor.timer = setTimeout(cursor.remove, 1600);
 } catch {} })()`;
}
