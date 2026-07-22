import type { Terminal as XTerm } from "@xterm/xterm";

// Image paste for the terminal.
//
// A fresh screenshot puts an image on the clipboard with *no* text, so xterm's
// built-in paste handler reads an empty `text/plain` and pastes nothing. The
// previous fix forwarded a bare Ctrl+V (`\x16`), assuming the TUI would read the
// OS clipboard itself. That's false for Claude Code on Windows: its terminal
// only reads the clipboard on an *empty bracketed paste*, and only on macOS/WSL
// (verified in the CLI's paste handler — the `(isMac || isWsl)` guard). A raw
// `\x16` is simply ignored there, which is why "Ctrl+V a screenshot" silently
// did nothing under the desktop app while it worked in VS Code.
//
// What DOES work on every platform is pasting an image *file path*: Claude Code,
// Codex, and opencode all recognize a pasted path ending in an image extension
// and attach the file. That's exactly what VS Code's terminal does on image
// paste. So we write the pasted bitmap to a temp file (main process) and
// bracketed-paste its quoted absolute path.
//
// This module stays free of Electron/tRPC imports so it can be unit-tested; the
// concrete "bytes -> temp path" step is injected as `saveImage`.

export interface ClipboardImagePayload {
	/** Raw image bytes, base64-encoded (no data-URL prefix). */
	base64: string;
	/** Source MIME type, e.g. "image/png". */
	mimeType: string;
}

/** Persists the image bytes somewhere the TUI can read and returns its path. */
export type SaveClipboardImage = (
	payload: ClipboardImagePayload,
) => Promise<string>;

/**
 * Find the image File on a paste's DataTransfer, if any. Chromium synthesizes a
 * File for bitmap clipboards (screenshots, right-click "Copy Image", drag-drop),
 * exposed via both `items` and `files`; we check both.
 */
export function getPastedImageFile(data: DataTransfer | null): File | null {
	if (!data) return null;

	const item = Array.from(data.items ?? []).find(
		(entry) => entry.kind === "file" && entry.type.startsWith("image/"),
	);
	const fromItem = item?.getAsFile();
	if (fromItem?.type.startsWith("image/")) return fromItem;

	const fromFiles = Array.from(data.files ?? []).find((file) =>
		file.type.startsWith("image/"),
	);
	return fromFiles ?? null;
}

/**
 * Base64-encode bytes in chunks. A single `String.fromCharCode(...bytes)` blows
 * the call stack for multi-MB screenshots, so we build the binary string in
 * fixed-size slices before `btoa`.
 */
function bytesToBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/**
 * Save a pasted image file and bracketed-paste its path into the terminal.
 * Falls back to the legacy `\x16` forward if the save fails, so behavior is
 * never worse than before.
 */
export async function pasteImageFileToTerminal(
	terminal: XTerm,
	file: File,
	saveImage: SaveClipboardImage,
): Promise<void> {
	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const path = await saveImage({
			base64: bytesToBase64(bytes),
			mimeType: file.type,
		});
		// Quote the path so usernames/dirs with spaces stay a single paste token;
		// the TUIs strip the surrounding quotes before resolving the file.
		terminal.paste(`"${path}"`);
	} catch (error) {
		console.error("[Terminal] Failed to paste clipboard image:", error);
		terminal.input("\x16", true);
	}
}

/**
 * Install a capture-phase paste listener that intercepts image-only pastes and
 * routes them through {@link pasteImageFileToTerminal}. Text pastes are left to
 * xterm's built-in handler; non-image file pastes keep the legacy `\x16`
 * forward (agents that read the OS clipboard directly still work).
 *
 * `target` should be an ancestor of xterm's textarea (the wrapper or
 * `xterm.element`) so capture runs before xterm's own paste handler and
 * `stopImmediatePropagation` cleanly preempts the empty bracketed-paste wrap.
 */
export function installImagePasteHandler(
	target: HTMLElement,
	terminal: XTerm,
	saveImage: SaveClipboardImage,
): () => void {
	const handler = (event: ClipboardEvent) => {
		const data = event.clipboardData;
		if (!data) return;
		// Prefer text: lets users paste URLs/paths even when an image is also
		// present (e.g. "Copy Image Address" style clipboards).
		if (data.getData("text/plain").length > 0) return;

		const imageFile = getPastedImageFile(data);
		if (imageFile) {
			event.preventDefault();
			event.stopImmediatePropagation();
			void pasteImageFileToTerminal(terminal, imageFile, saveImage);
			return;
		}

		// Non-image file payload (copied file/folder): preserve the legacy Ctrl+V
		// forward for TUIs that read the OS clipboard themselves.
		if ((data.files?.length ?? 0) > 0) {
			event.preventDefault();
			event.stopImmediatePropagation();
			terminal.input("\x16", true);
		}
	};

	target.addEventListener("paste", handler, { capture: true });
	return () => {
		target.removeEventListener("paste", handler, { capture: true });
	};
}
