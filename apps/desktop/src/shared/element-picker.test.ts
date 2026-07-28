import { describe, expect, it } from "bun:test";
import {
	buildSelector,
	formatPickedElement,
	isStableClass,
	type PickedElement,
	type PickedNode,
	truncate,
} from "./element-picker";

function node(partial: Partial<PickedNode> & { tag: string }): PickedNode {
	return {
		id: null,
		classes: [],
		nthOfType: 1,
		sameTagSiblings: 1,
		...partial,
	};
}

describe("isStableClass", () => {
	it("keeps names that describe what a thing IS", () => {
		for (const name of ["site-header", "ProductCard", "nav_primary", "hero"]) {
			expect(isStableClass(name)).toBe(true);
		}
	});

	it("rejects utility classes that describe how it LOOKS", () => {
		// A selector built from these reads as specific and breaks on the next
		// restyle, which is worse than a longer positional selector.
		for (const name of [
			"flex",
			"px-4",
			"text-sm",
			"bg-muted",
			"rounded-lg",
			"absolute",
			"hidden",
			"font-medium",
		]) {
			expect(isStableClass(name)).toBe(false);
		}
	});

	it("rejects variants and arbitrary values", () => {
		for (const name of ["md:flex", "hover:bg-red-500", "w-[32px]", "p-1.5"]) {
			expect(isStableClass(name)).toBe(false);
		}
	});

	it("rejects empty and whitespace-bearing input", () => {
		expect(isStableClass("")).toBe(false);
		expect(isStableClass("two names")).toBe(false);
	});
});

describe("buildSelector", () => {
	it("stops at an id, because nothing above it adds anything", () => {
		expect(
			buildSelector([
				node({ tag: "body" }),
				node({ tag: "div", id: "root" }),
				node({ tag: "span" }),
			]),
		).toBe("#root > span");
	});

	it("prefers a stable class over position", () => {
		expect(
			buildSelector([
				node({ tag: "div", classes: ["site-header"] }),
				node({ tag: "a", classes: ["flex", "nav-link", "px-2"] }),
			]),
		).toBe("div.site-header > a.nav-link");
	});

	it("falls back to nth-of-type only where there is ambiguity", () => {
		// A lone <main> does not need :nth-of-type(1); a third <li> does.
		expect(
			buildSelector([
				node({ tag: "main" }),
				node({ tag: "li", nthOfType: 3, sameTagSiblings: 5 }),
			]),
		).toBe("main > li:nth-of-type(3)");
	});

	it("skips utility classes entirely rather than emitting them", () => {
		expect(
			buildSelector([node({ tag: "button", classes: ["px-4", "rounded-lg"] })]),
		).toBe("button");
	});

	it("escapes characters that would break the selector", () => {
		expect(buildSelector([node({ tag: "div", id: "main:content" })])).toBe(
			"#main\\:content",
		);
	});

	it("returns empty for an empty chain rather than throwing", () => {
		expect(buildSelector([])).toBe("");
	});
});

describe("truncate", () => {
	it("leaves short values alone", () => {
		expect(truncate("  hello  ", 50)).toBe("hello");
	});

	it("says how much was cut, so the size is not a mystery", () => {
		const result = truncate("x".repeat(500), 100);
		expect(result).toContain("truncated (500 chars total)");
		expect(result.startsWith("x".repeat(100))).toBe(true);
	});
});

describe("formatPickedElement", () => {
	const picked: PickedElement = {
		chain: [node({ tag: "div", id: "app" }), node({ tag: "button" })],
		attributes: { type: "submit" },
		text: "Book now",
		html: '<button type="submit">Book now</button>',
		styles: { display: "inline-flex", color: "rgb(255, 255, 255)" },
		rect: { width: 120.4, height: 40.2 },
		url: "https://yddetailers.com",
	};

	it("leads with the selector, which is the actionable part", () => {
		expect(formatPickedElement(picked)).toContain("Selector: `#app > button`");
	});

	it("fences the markup so it survives being pasted", () => {
		const output = formatPickedElement(picked);
		expect(output).toContain("```html");
		expect(output).toContain('<button type="submit">Book now</button>');
	});

	it("rounds the size instead of printing sub-pixel noise", () => {
		expect(formatPickedElement(picked)).toContain("Size: 120×40px");
	});

	it("asks no question", () => {
		// This ATTACHES context, same as the page-capture route. Guessing the
		// question would be wrong most of the time and the caret is right there.
		const output = formatPickedElement(picked);
		expect(output).not.toContain("?");
	});

	it("omits sections it has nothing for", () => {
		const bare = formatPickedElement({
			...picked,
			attributes: {},
			text: "   ",
			styles: {},
		});
		expect(bare).not.toContain("Attributes:");
		expect(bare).not.toContain("Text:");
		expect(bare).not.toContain("Computed styles:");
		// The markup is the one thing always worth including.
		expect(bare).toContain("```html");
	});
});
