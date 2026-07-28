import { describe, expect, it } from "bun:test";
import { MOBILE_BRIDGE_HTML } from "./client-html";

/**
 * The page is an inlined string with no build step, so nothing type-checks it,
 * bundles it or even parses it before a phone does. These tests are the only
 * thing standing between a stray character and a blank screen on a device
 * that is, by definition, not next to a debugger.
 */

function scriptBody(): string {
	const match = MOBILE_BRIDGE_HTML.match(/<script>([\s\S]*?)<\/script>/);
	return match?.[1] ?? "";
}

describe("the phone page", () => {
	it("has a script to check", () => {
		// Guards every other test here from passing on an empty string.
		expect(scriptBody().length).toBeGreaterThan(500);
	});

	it("parses as JavaScript", () => {
		// `new Function` compiles without running, which is exactly the check
		// wanted: syntax only, no side effects, no DOM needed.
		expect(() => new Function(scriptBody())).not.toThrow();
	});

	it("leaves no unresolved template interpolation", () => {
		// The HTML lives in a TS template literal. A stray `${...}` would have
		// been substituted at module load and silently changed the page.
		expect(MOBILE_BRIDGE_HTML).not.toContain("${");
	});

	it("emits the regex escapes it meant to", () => {
		// `\\s` in the TS source has to reach the browser as `\s`. Getting this
		// wrong yields a regex that matches a literal "s".
		expect(scriptBody()).toContain("replace(/\\s+$/");
		expect(scriptBody()).not.toContain("replace(/\\\\s+$/");
	});
});

describe("voice input", () => {
	const script = scriptBody();

	it("uses the phone's own recogniser, never the desktop", () => {
		// The whole point of the revised 4.3: audio does not leave the phone and
		// the desktop has no capture path at all.
		expect(script).toContain("window.webkitSpeechRecognition");
		expect(script).not.toContain("/api/voice");
	});

	it("checks the secure context before offering the button", () => {
		// SpeechRecognition throws on plain HTTP, which is the DEFAULT link mode.
		// Without this the button would be visible and broken for most users.
		expect(script).toContain("window.isSecureContext");
	});

	it("keeps the button hidden until both checks pass", () => {
		expect(MOBILE_BRIDGE_HTML).toContain('id="mic" aria-label="Dictate"');
		expect(MOBILE_BRIDGE_HTML).toMatch(/id="mic"[^>]*hidden/);
	});

	it("appends to the composer instead of replacing it", () => {
		expect(script).toContain("baseText + committedText");
	});

	it("rebuilds the transcript from index 0 rather than accumulating", () => {
		// The duplication bug: reading from event.resultIndex and doing
		// `final += ...` re-appends already-finished words once per event,
		// because browsers commonly report resultIndex as 0 every time.
		expect(script).toContain("for (var i = 0; i < event.results.length; i++)");
		// The loop INITIALISER specifically — `event.resultIndex` still appears
		// in the comment above it explaining why this must not be used.
		expect(script).not.toContain("i = event.resultIndex");
	});

	it("banks finished text before a restart clears the results", () => {
		expect(script).toContain("committedText += sessionText");
	});

	it("restarts itself so a pause does not end dictation", () => {
		expect(script).toContain("recog.onend");
	});

	it("clears the listening flag before stopping, so onend cannot restart it", () => {
		// Ordering bug bait: stop() fires onend, and onend restarts while
		// `listening` is still true. The mic would be impossible to turn off.
		const stopMic = script.slice(script.indexOf("function stopMic()"));
		expect(stopMic.indexOf("listening = false")).toBeLessThan(
			stopMic.indexOf("recog.stop()"),
		);
	});

	it("never sends on its own", () => {
		// This drives an agent that runs shell commands. A misheard word should
		// cost a glance at the composer, not a turn.
		const send = script.slice(
			script.indexOf("function send()"),
			script.indexOf("sendBtn.onclick"),
		);
		expect(send).toContain("stopMic()");
	});
});
