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
