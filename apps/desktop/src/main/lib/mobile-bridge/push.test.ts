import { expect, test } from "bun:test";
import { PushService } from "./push";

test("phone completions expire and are invalidated when that session resumes", async () => {
	let now = 100;
	const push = new PushService(
		() => [],
		() => now,
	);
	await push.notify({
		title: "Filtrsoft - Complete",
		body: "Finished",
		sessionKey: "filtrsoft",
	});
	const first = push.takePending();
	expect(first?.title).toBe("Filtrsoft - Complete");
	expect(first?.id).toBeTruthy();
	push.invalidate("jarvis");
	expect(push.takePending()?.id).toBe(first?.id);
	push.invalidate("filtrsoft");
	expect(push.takePending()).toBeNull();
	await push.notify({
		title: "Jarvis - Complete",
		body: "Finished",
		sessionKey: "jarvis",
	});
	expect(push.takePending()?.id).not.toBe(first?.id);
	now += 30001;
	expect(push.takePending()).toBeNull();
});

test("push records provider from native metadata for unprefixed pane keys", async () => {
	const push = new PushService(
		() => [],
		Date.now,
		(key) => (key === "codex-pane" ? "codex" : "claude"),
	);
	await push.notify({
		title: "Done",
		body: "Finished",
		sessionKey: "codex-pane",
	});
	expect(push.takePending()?.provider).toBe("codex");
	await push.notify({
		title: "Done",
		body: "Finished",
		sessionKey: "claude-pane",
	});
	expect(push.takePending()?.provider).toBe("claude");
});

test("unknown providers are not mislabeled and explicit supported providers survive", async () => {
	const push = new PushService(
		() => [],
		Date.now,
		() => undefined,
	);
	await push.notify({
		title: "Done",
		body: "Finished",
		sessionKey: "legacy-pane",
	});
	expect(push.takePending()?.provider).toBeUndefined();
	await push.notify({
		title: "Done",
		body: "Finished",
		sessionKey: "closed-codex",
		provider: "codex",
	});
	expect(push.takePending()?.provider).toBe("codex");
});
