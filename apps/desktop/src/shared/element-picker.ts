/**
 * Turning a clicked DOM element into something an agent can act on.
 *
 * The in-page script (see `BrowserPane/element-picker-script.ts`) is
 * deliberately dumb: it draws the highlight, waits for a click, and harvests
 * plain facts about the element and its ancestors. Everything that requires
 * judgement — which selector is stable, what is worth showing, how much HTML is
 * too much — lives here, in ordinary TypeScript that can be tested without a
 * browser.
 *
 * That split exists because the script is a STRING injected via
 * `executeJavaScript`. Nothing typechecks it and nothing can unit-test it, so
 * the less it decides, the less can silently go wrong.
 */

export interface PickedNode {
	tag: string;
	id: string | null;
	classes: string[];
	/** 1-based position among siblings of the same tag. */
	nthOfType: number;
	/** How many siblings share this tag, including this one. */
	sameTagSiblings: number;
}

export interface PickedElement {
	/** Target LAST, its ancestors before it, nearest ancestor closest to it. */
	chain: PickedNode[];
	attributes: Record<string, string>;
	text: string;
	html: string;
	styles: Record<string, string>;
	rect: { width: number; height: number };
	url: string;
}

/**
 * Classes a selector should never be built from.
 *
 * Utility-first CSS (Tailwind here) means most classes describe appearance and
 * change the moment anyone restyles the element. A selector built from
 * `flex` or `px-4` reads as specific and breaks on the next design tweak, which
 * is worse than a slightly longer positional one.
 */
const UNSTABLE_CLASS = new RegExp(
	// Optional variant prefix: `md:`, `hover:`, `dark:`.
	"^(?:[a-z-]+:)?" +
		"(?:" +
		// Padding and margin, including the directional forms (px, mt, …). The
		// bare-letter version alone misses `px-4`, which is the single most
		// common utility class there is.
		"[pm][xytrbl]?|" +
		"w|h|min|max|size|gap|space|inset|top|left|right|bottom|z|" +
		"text|bg|border|rounded|shadow|opacity|ring|outline|divide|fill|stroke|" +
		"flex|grid|items|justify|self|order|basis|grow|shrink|col|row|" +
		"font|leading|tracking|truncate|whitespace|break|" +
		"overflow|object|aspect|" +
		"transition|duration|ease|delay|animate|translate|scale|rotate|skew|origin|" +
		"cursor|select|pointer|resize|" +
		"absolute|relative|fixed|sticky|static|block|inline|hidden|table|contents|" +
		"hover|focus|active|group|peer|placeholder|caret|accent|backdrop|blur" +
		")" +
		// Must be the WHOLE stem: `col-span-2` is a utility, `column` is a name.
		"(?:-|$)",
);

export function isStableClass(className: string): boolean {
	if (!className || /\s/.test(className)) return false;
	// Escaped Tailwind arbitrary values (`w-[32px]`, `md:flex`) are never stable.
	if (/[[\]/:.%]/.test(className)) return false;
	return !UNSTABLE_CLASS.test(className);
}

function escapeIdent(value: string): string {
	return value.replace(/([^\w-])/g, "\\$1");
}

/**
 * A selector for the picked node, as short as it can be while still pointing
 * at one element.
 *
 * Preference order per node: an id (stop immediately — ids are unique and
 * nothing shorter exists), then a stable-looking class, then position among
 * same-tag siblings. Walking stops at the first id because everything above it
 * is redundant.
 */
export function buildSelector(chain: PickedNode[]): string {
	if (chain.length === 0) return "";

	const parts: string[] = [];
	for (let i = chain.length - 1; i >= 0; i--) {
		const node = chain[i] as PickedNode;

		if (node.id) {
			parts.unshift(`#${escapeIdent(node.id)}`);
			break;
		}

		const stable = node.classes.filter(isStableClass);
		if (stable.length > 0) {
			parts.unshift(`${node.tag}.${escapeIdent(stable[0] as string)}`);
			continue;
		}

		// Only qualify by position when there is ambiguity to resolve; a lone
		// `<main>` does not need `:nth-of-type(1)`.
		parts.unshift(
			node.sameTagSiblings > 1
				? `${node.tag}:nth-of-type(${node.nthOfType})`
				: node.tag,
		);
	}

	return parts.join(" > ");
}

/** Long enough to show structure, short enough not to bury the prompt. */
const MAX_HTML_CHARS = 1200;
const MAX_TEXT_CHARS = 300;

export function truncate(value: string, limit: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= limit) return trimmed;
	return `${trimmed.slice(0, limit)}\n… truncated (${trimmed.length} chars total)`;
}

/**
 * The block that lands in the composer.
 *
 * Markdown with a fenced HTML block, because that is what the agent reads best
 * and what survives being pasted somewhere else. Styles are listed as plain
 * `key: value` lines rather than a table — a table of six rows costs more
 * characters than it saves in legibility.
 *
 * No question is appended. Like the page-capture route, this ATTACHES context
 * and leaves the caret to the user: "what is wrong with this element" is a
 * guess, and usually the wrong one.
 */
export function formatPickedElement(picked: PickedElement): string {
	const selector = buildSelector(picked.chain);
	const lines: string[] = [
		`Element on ${picked.url}`,
		"",
		`Selector: \`${selector}\``,
		`Size: ${Math.round(picked.rect.width)}×${Math.round(picked.rect.height)}px`,
	];

	const attrs = Object.entries(picked.attributes);
	if (attrs.length > 0) {
		lines.push(`Attributes: ${attrs.map(([k, v]) => `${k}="${v}"`).join(" ")}`);
	}

	if (picked.text.trim()) {
		lines.push("", `Text: ${truncate(picked.text, MAX_TEXT_CHARS)}`);
	}

	const styles = Object.entries(picked.styles);
	if (styles.length > 0) {
		lines.push("", "Computed styles:");
		for (const [property, value] of styles) {
			lines.push(`  ${property}: ${value}`);
		}
	}

	lines.push("", "```html", truncate(picked.html, MAX_HTML_CHARS), "```");
	return lines.join("\n");
}
