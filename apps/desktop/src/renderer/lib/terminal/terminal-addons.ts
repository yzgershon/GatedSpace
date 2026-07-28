import { ClipboardAddon } from "@xterm/addon-clipboard";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ProgressAddon } from "@xterm/addon-progress";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal as XTerm } from "@xterm/xterm";
import { Utf8Base64 } from "./clipboard-base64";
import { attachRepaintWatchdog } from "./terminal-repaint-watchdog";

export interface LoadAddonsResult {
	searchAddon: SearchAddon;
	progressAddon: ProgressAddon;
	dispose: () => void;
}

// If WebGL is genuinely unavailable (construction throws), skip it for all
// subsequent runtimes (VS Code pattern). A transient *context loss* does NOT
// set this — see onContextLoss below.
let suggestedRendererType: "webgl" | "dom" | undefined;

/**
 * Load optional addons onto an already-opened terminal. Returns a cleanup
 * function and addon instances. WebGL is deferred to rAF to avoid
 * racing with xterm's post-open viewport sync.
 */
export function loadAddons(terminal: XTerm): LoadAddonsResult {
	let disposed = false;
	let webglAddon: WebglAddon | null = null;

	// Utf8Base64 replaces the addon's UTF-8-unsafe default codec (#4839).
	terminal.loadAddon(new ClipboardAddon(new Utf8Base64()));

	const unicode11 = new Unicode11Addon();
	terminal.loadAddon(unicode11);
	terminal.unicode.activeVersion = "11";

	terminal.loadAddon(new ImageAddon());

	const searchAddon = new SearchAddon();
	terminal.loadAddon(searchAddon);

	const progressAddon = new ProgressAddon();
	terminal.loadAddon(progressAddon);

	try {
		terminal.loadAddon(new LigaturesAddon());
	} catch {}

	const rafId = requestAnimationFrame(() => {
		if (disposed || suggestedRendererType === "dom") return;

		try {
			webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				// Context loss is usually transient, or the result of Chromium's
				// per-page WebGL context cap when several agents run at once.
				// Downgrade ONLY this terminal to the DOM renderer — do NOT poison
				// the module-global, or a single lost context would cascade every
				// current and future terminal onto the slow renderer. That cascade
				// is what makes the "thinking" spinners stutter once multiple agents
				// are running.
				webglAddon?.dispose();
				webglAddon = null;
				terminal.refresh(0, terminal.rows - 1);
			});
			terminal.loadAddon(webglAddon);
		} catch {
			suggestedRendererType = "dom";
			webglAddon = null;
		}
	});

	// Wake, re-focus and DPR changes all leave the drawing surface stale without
	// xterm hearing about it, so a healthy session can sit behind a blank or
	// blurry pane indefinitely. The renderer is resolved lazily because the
	// WebGL addon attaches a frame later and can be dropped by a context loss.
	const detachRepaintWatchdog = attachRepaintWatchdog({
		terminal,
		getRenderer: () => webglAddon,
	});

	return {
		searchAddon,
		progressAddon,
		dispose: () => {
			disposed = true;
			cancelAnimationFrame(rafId);
			detachRepaintWatchdog();
			try {
				webglAddon?.dispose();
			} catch {}
			webglAddon = null;
		},
	};
}
