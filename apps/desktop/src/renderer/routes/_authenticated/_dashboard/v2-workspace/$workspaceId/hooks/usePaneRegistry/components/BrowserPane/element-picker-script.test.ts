import { describe, expect, it } from "bun:test";
import { ELEMENT_PICKER_SCRIPT } from "./element-picker-script";

/**
 * The script is a STRING handed to `executeJavaScript`. Nothing typechecks it,
 * nothing bundles it, and a syntax error surfaces as a picker that silently
 * does nothing inside a page the user is already suspicious of. These checks
 * are the only thing between a stray character and that.
 */

describe("the element picker script", () => {
	it("is substantial enough that the checks below mean something", () => {
		expect(ELEMENT_PICKER_SCRIPT.length).toBeGreaterThan(1000);
	});

	it("parses as JavaScript", () => {
		// `new Function` compiles without running: syntax only, no DOM needed.
		expect(() => new Function(ELEMENT_PICKER_SCRIPT)).not.toThrow();
	});

	it("evaluates to a promise, which is how the result gets back", () => {
		// executeJavaScript resolves with the script's value, so the whole
		// interaction is one round trip only because this returns a Promise.
		expect(ELEMENT_PICKER_SCRIPT).toContain("return new Promise");
	});

	it("leaves no unresolved template interpolation", () => {
		// The style and attribute lists are injected with JSON.stringify at
		// module load; a stray `${` would have been substituted silently.
		expect(ELEMENT_PICKER_SCRIPT).not.toContain("${");
	});

	it("injects the reported style and attribute lists as real arrays", () => {
		expect(ELEMENT_PICKER_SCRIPT).toContain('"background-color"');
		expect(ELEMENT_PICKER_SCRIPT).toContain('"data-testid"');
	});

	it("removes everything it added on every exit path", () => {
		// A picker that leaves a transparent overlay on the page is
		// indistinguishable from a browser that has stopped responding.
		const cleanupCalls = ELEMENT_PICKER_SCRIPT.match(/cleanup\(\)/g) ?? [];
		// Escape, click, the outside-cancel hook — plus the definition site.
		expect(cleanupCalls.length).toBeGreaterThanOrEqual(3);
		expect(ELEMENT_PICKER_SCRIPT).toContain("removeEventListener");
		expect(ELEMENT_PICKER_SCRIPT).toContain("previousCursor");
	});

	it("cancels a previous picker instead of stacking overlays", () => {
		expect(ELEMENT_PICKER_SCRIPT).toContain("__gatedspacePickerCancel");
	});

	it("stops the click from activating the page", () => {
		// Picking a link must not navigate; picking a submit button must not
		// submit. Capture phase, and both halves of the suppression.
		expect(ELEMENT_PICKER_SCRIPT).toContain("event.preventDefault()");
		expect(ELEMENT_PICKER_SCRIPT).toContain("event.stopPropagation()");
		expect(ELEMENT_PICKER_SCRIPT).toContain(
			'document.addEventListener("click", onClick, true)',
		);
	});

	it("resolves null when cancelled, so the caller can tell them apart", () => {
		expect(ELEMENT_PICKER_SCRIPT).toContain("resolve(null)");
	});

	it("caps the ancestor walk", () => {
		// A selector built from thirty ancestors helps nobody, and deeply nested
		// app markup is the normal case.
		expect(ELEMENT_PICKER_SCRIPT).toContain("chain.length < 8");
	});
});
