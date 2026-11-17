import { expect, test } from "bun:test";

test("a fresh renderer draft restores choices by conversation and never persists a queued preview", async () => {
	const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	const disk = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => disk.get(key) ?? null,
			setItem: (key: string, value: string) => disk.set(key, value),
		},
	});
	try {
		const modulePath = "./draft";
		const first: typeof import("./draft") = await import(
			`${modulePath}?first=${crypto.randomUUID()}`
		);
		first.bindCodexDraftSession("old-pane", "same-conversation");
		first.updateCodexDraft("old-pane", {
			model: "chosen-model",
			effort: "high",
			fast: true,
			text: "Unsent text",
		});
		first.updateCodexDraft(
			"old-pane",
			{ fast: false, effort: "low" },
			{ transient: true },
		);
		expect(first.getCodexDraft("old-pane").fast).toBe(false);
		const restarted: typeof import("./draft") = await import(
			`${modulePath}?restarted=${crypto.randomUUID()}`
		);
		expect(restarted.getCodexDraft("old-pane")).toMatchObject({
			model: "chosen-model",
			effort: "high",
			fast: true,
			text: "Unsent text",
		});
		restarted.bindCodexDraftSession("new-pane", "same-conversation");
		expect(restarted.getCodexDraft("new-pane")).toMatchObject({
			model: "chosen-model",
			effort: "high",
			fast: true,
			text: "",
		});
		restarted.updateCodexDraft("new-pane", { text: "", images: [] });
		restarted.bindCodexDraftSession("new-pane", "same-conversation");
		expect(restarted.getCodexDraft("new-pane").fast).toBe(true);
		expect(restarted.getCodexDraft("unrelated").fast).toBeUndefined();
	} finally {
		if (prior) Object.defineProperty(globalThis, "localStorage", prior);
		else Reflect.deleteProperty(globalThis, "localStorage");
	}
});
