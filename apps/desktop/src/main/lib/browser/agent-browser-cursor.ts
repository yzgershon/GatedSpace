/** A page-local visual pointer. It never moves Windows input or receives events. */
export function browserCursorScript(
	point: { x: number; y: number } | null,
	session?: string,
) {
	const label = session?.startsWith("claude:") ? "Claude" : "Codex";
	const color = label === "Claude" ? "#e5a07b" : "#5de4c7";
	return `(() => {
		const point = ${JSON.stringify(point)} ?? (() => {
			const r = document.activeElement?.getBoundingClientRect();
			return r && r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null;
		})();
		if (!point) return;
		globalThis.__gsBrowserCursor?.remove();
		const host = document.createElement('div');
		host.setAttribute('data-gatedspace-agent-cursor', '');
		host.setAttribute('aria-hidden', 'true');
		host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;contain:layout style!important;';
		const shadow = host.attachShadow({mode:'closed'});
		const x = Math.max(2, Math.min(innerWidth-22, point.x));
		const y = Math.max(2, Math.min(innerHeight-26, point.y));
		shadow.innerHTML = '<style>:host,*{pointer-events:none!important} .pointer{position:absolute;color:${color};filter:drop-shadow(0 2px 3px #0009)} .label{position:absolute;top:22px;left:14px;white-space:nowrap;font:600 11px/18px system-ui,sans-serif;padding:1px 7px;border-radius:6px;background:#282a36;color:${color};box-shadow:0 1px 5px #0005} .ring{position:absolute;left:-12px;top:-12px;width:24px;height:24px;border:2px solid currentColor;border-radius:50%;animation:ping 420ms ease-out both}@keyframes ping{from{transform:scale(.35);opacity:.8}to{transform:scale(1.3);opacity:0}}@media(prefers-reduced-motion:reduce){.ring{animation:none;opacity:.3}}</style><div class="pointer"><span class="ring"></span><svg width="20" height="24" viewBox="0 0 20 24"><path d="M2 2v17l4.5-4 4 7 3-1.7-4-7 6-.5Z" fill="currentColor" stroke="#282a36" stroke-width="1.5" stroke-linejoin="round"/></svg><span class="label">${label}</span></div>';
		const pointer = shadow.querySelector('.pointer');
		pointer.style.left = x+'px'; pointer.style.top = y+'px';
		const label = shadow.querySelector('.label');
		if (x > innerWidth-100) { label.style.left='auto'; label.style.right='12px'; }
		if (y > innerHeight-55) label.style.top='-22px';
		document.documentElement.appendChild(host);
		const remove = () => { clearTimeout(timer); host.remove(); };
		const timer = setTimeout(remove, 1600);
		globalThis.__gsBrowserCursor = {remove};
	})()`;
}
