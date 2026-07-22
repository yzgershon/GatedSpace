import { describe, expect, it, mock } from "bun:test";
import type { Terminal as XTerm } from "@xterm/xterm";
import {
	getPastedImageFile,
	installImagePasteHandler,
	pasteImageFileToTerminal,
	type SaveClipboardImage,
} from "./terminal-image-paste";

interface FakeDataTransfer {
	items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
	files?: File[];
	text?: string;
}

function dataTransfer(data: FakeDataTransfer): DataTransfer {
	return {
		items: data.items ?? [],
		files: data.files ?? [],
		getData: (type: string) => (type === "text/plain" ? (data.text ?? "") : ""),
	} as unknown as DataTransfer;
}

function pngFile(bytes = [1, 2, 3], type = "image/png"): File {
	return new File([new Uint8Array(bytes)], "clip.png", { type });
}

function imageItem(file: File | null, type = "image/png") {
	return { kind: "file", type, getAsFile: () => file };
}

function clipboardEvent(data: FakeDataTransfer) {
	const flags = { defaultPrevented: false, immediateStopped: false };
	const event = {
		type: "paste",
		clipboardData: dataTransfer(data),
		preventDefault() {
			flags.defaultPrevented = true;
		},
		stopImmediatePropagation() {
			flags.immediateStopped = true;
		},
	} as unknown as ClipboardEvent;
	return { event, flags };
}

function makeFakeTerminal() {
	const input = mock((_data: string, _user?: boolean) => {});
	const paste = mock((_data: string) => {});
	return { terminal: { input, paste } as unknown as XTerm, input, paste };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("getPastedImageFile", () => {
	it("returns the image File from items", () => {
		const file = pngFile();
		expect(getPastedImageFile(dataTransfer({ items: [imageItem(file)] }))).toBe(
			file,
		);
	});

	it("falls back to files when items has none", () => {
		const file = pngFile();
		expect(getPastedImageFile(dataTransfer({ files: [file] }))).toBe(file);
	});

	it("ignores non-image file items", () => {
		const file = new File(["x"], "notes.txt", { type: "text/plain" });
		expect(
			getPastedImageFile(
				dataTransfer({ items: [imageItem(file, "text/plain")] }),
			),
		).toBeNull();
	});

	it("returns null for an empty clipboard", () => {
		expect(getPastedImageFile(dataTransfer({}))).toBeNull();
	});

	it("returns null for null data", () => {
		expect(getPastedImageFile(null)).toBeNull();
	});
});

describe("pasteImageFileToTerminal", () => {
	it("saves the image and pastes its quoted path", async () => {
		const { terminal, paste, input } = makeFakeTerminal();
		const save: SaveClipboardImage = mock(async () => "C:\\tmp\\clip.png");

		await pasteImageFileToTerminal(terminal, pngFile([1, 2, 3, 4]), save);

		expect(save).toHaveBeenCalledTimes(1);
		const payload = (save as ReturnType<typeof mock>).mock.calls[0][0];
		expect(payload.mimeType).toBe("image/png");
		expect(typeof payload.base64).toBe("string");
		expect(payload.base64.length).toBeGreaterThan(0);
		expect(paste).toHaveBeenCalledWith('"C:\\tmp\\clip.png"');
		expect(input).not.toHaveBeenCalled();
	});

	it("falls back to Ctrl+V when the save fails", async () => {
		const { terminal, paste, input } = makeFakeTerminal();
		const save: SaveClipboardImage = mock(async () => {
			throw new Error("nope");
		});

		await pasteImageFileToTerminal(terminal, pngFile(), save);

		expect(paste).not.toHaveBeenCalled();
		expect(input).toHaveBeenCalledWith("\x16", true);
	});
});

describe("installImagePasteHandler", () => {
	function makeTarget() {
		let handler: EventListener | null = null;
		const target = {
			addEventListener: mock((_type: string, h: EventListener) => {
				handler = h;
			}),
			removeEventListener: mock(() => {
				handler = null;
			}),
		};
		return {
			target: target as unknown as HTMLElement,
			fire: (event: ClipboardEvent) => handler?.(event),
			hasHandler: () => handler !== null,
		};
	}

	it("intercepts an image-only paste and saves it", async () => {
		const { target, fire } = makeTarget();
		const { terminal, paste, input } = makeFakeTerminal();
		const save: SaveClipboardImage = mock(async () => "C:\\tmp\\clip.png");
		installImagePasteHandler(target, terminal, save);

		const { event, flags } = clipboardEvent({ items: [imageItem(pngFile())] });
		fire(event);
		await flush();

		expect(flags.defaultPrevented).toBe(true);
		expect(flags.immediateStopped).toBe(true);
		expect(save).toHaveBeenCalledTimes(1);
		expect(paste).toHaveBeenCalledWith('"C:\\tmp\\clip.png"');
		expect(input).not.toHaveBeenCalled();
	});

	it("leaves text pastes to xterm's built-in handler", async () => {
		const { target, fire } = makeTarget();
		const { terminal, paste, input } = makeFakeTerminal();
		const save: SaveClipboardImage = mock(async () => "C:\\tmp\\clip.png");
		installImagePasteHandler(target, terminal, save);

		const { event, flags } = clipboardEvent({ text: "hello" });
		fire(event);
		await flush();

		expect(flags.defaultPrevented).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(paste).not.toHaveBeenCalled();
		expect(input).not.toHaveBeenCalled();
	});

	it("prefers text when both text and image are present", async () => {
		const { target, fire } = makeTarget();
		const { terminal, paste } = makeFakeTerminal();
		const save: SaveClipboardImage = mock(async () => "C:\\tmp\\clip.png");
		installImagePasteHandler(target, terminal, save);

		const { event, flags } = clipboardEvent({
			text: "https://example.com/x.png",
			items: [imageItem(pngFile())],
		});
		fire(event);
		await flush();

		expect(flags.defaultPrevented).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(paste).not.toHaveBeenCalled();
	});

	it("keeps the legacy Ctrl+V forward for non-image file pastes", async () => {
		const { target, fire } = makeTarget();
		const { terminal, paste, input } = makeFakeTerminal();
		const save: SaveClipboardImage = mock(async () => "C:\\tmp\\clip.png");
		installImagePasteHandler(target, terminal, save);

		const textFile = new File(["x"], "notes.txt", { type: "text/plain" });
		const { event, flags } = clipboardEvent({ files: [textFile] });
		fire(event);
		await flush();

		expect(flags.defaultPrevented).toBe(true);
		expect(flags.immediateStopped).toBe(true);
		expect(save).not.toHaveBeenCalled();
		expect(input).toHaveBeenCalledWith("\x16", true);
		expect(paste).not.toHaveBeenCalled();
	});

	it("dispose removes the capture-phase listener", () => {
		const { target, hasHandler } = makeTarget();
		const { terminal } = makeFakeTerminal();
		const save: SaveClipboardImage = mock(async () => "p");

		const dispose = installImagePasteHandler(target, terminal, save);
		expect(hasHandler()).toBe(true);
		dispose();
		expect(hasHandler()).toBe(false);
	});
});
