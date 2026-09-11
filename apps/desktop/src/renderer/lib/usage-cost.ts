/**
 * Rough list-price cost of a bag of tokens.
 *
 * Extracted from the usage dialog so the sidebar's "Spent today" row and the
 * dialog cannot drift apart. One price table, one set of cache multipliers, one
 * estimate — two components showing different dollars for the same day is the
 * failure this exists to prevent.
 */

/** The shape any counted token bucket has to provide. */
export interface CostableModel {
	name: string;
	in: number;
	out: number;
	cacheRead?: number;
	cacheWrite?: number;
}

// USD per 1M tokens (input / output), Anthropic API list prices; Codex is
// approximated at GPT-5 rates. Unmatched models fall back to Sonnet-tier.
const PRICE_PER_MTOK: { match: RegExp; in: number; out: number }[] = [
	{ match: /opus/i, in: 15, out: 75 },
	{ match: /sonnet/i, in: 3, out: 15 },
	{ match: /haiku/i, in: 1, out: 5 },
	{ match: /fable/i, in: 3, out: 15 },
	{ match: /codex/i, in: 1.25, out: 10 },
];
const FALLBACK_PRICE = { in: 3, out: 15 };

/**
 * Prompt-cache multipliers, relative to the model's uncached input price.
 *
 * These are why the estimate used to be about 10x low: it counted only
 * uncached input and output. On a long agent session the cache dwarfs both —
 * one measured session showed 548M cache-read and 21M cache-write tokens
 * against 9k of uncached input. Ignoring them was not a rounding error, it was
 * ignoring essentially the entire bill.
 *
 * Writes use the 1-hour figure (2x) rather than the 5-minute one (1.25x)
 * because that is the TTL these sessions run with.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 2;

export function estimateCostUsd(models: CostableModel[]): number {
	let usd = 0;
	for (const m of models) {
		const p =
			PRICE_PER_MTOK.find((r) => r.match.test(m.name)) ?? FALLBACK_PRICE;
		usd +=
			(m.in / 1e6) * p.in +
			(m.out / 1e6) * p.out +
			((m.cacheRead ?? 0) / 1e6) * p.in * CACHE_READ_MULTIPLIER +
			((m.cacheWrite ?? 0) / 1e6) * p.in * CACHE_WRITE_MULTIPLIER;
	}
	return usd;
}

/** Dollars, at the precision the number deserves. */
export function formatUsd(n: number): string {
	if (n >= 10_000) return `$${(n / 1000).toFixed(0)}k`;
	if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
	if (n >= 100) return `$${n.toFixed(0)}`;
	return `$${n.toFixed(2)}`;
}
