import nspell from "nspell";
// Raw imports keep dictionary-en's Node filesystem entry out of the renderer.
import aff from "../../../../node_modules/dictionary-en/index.aff?raw";
import dic from "../../../../node_modules/dictionary-en/index.dic?raw";

const dictionary = nspell(aff, dic);
const cache = new Map<string, string[]>();

function nearestWords(word: string): string[] {
	const matches = new Set<string>();
	const offer = (candidate: string) => {
		if (candidate !== word && dictionary.correct(candidate))
			matches.add(candidate);
		return matches.size > 1;
	};
	// Bound lookup to one edit and stop at ambiguity; unrestricted Hunspell
	// suggestions can spend tens of milliseconds searching nonsense words.
	for (let i = 0; i <= word.length; i++) {
		const left = word.slice(0, i),
			right = word.slice(i);
		if (right && offer(left + right.slice(1))) break;
		if (right.length > 1 && offer(left + right[1] + right[0] + right.slice(2)))
			break;
		for (const letter of "abcdefghijklmnopqrstuvwxyz") {
			if (
				offer(left + letter + right) ||
				(right && offer(left + letter + right.slice(1)))
			)
				break;
		}
		if (matches.size > 1) break;
	}
	return [...matches];
}

export function spellingSuggestions(word: string): string[] {
	if (!/^[a-z]{4,24}$/.test(word) || dictionary.correct(word)) return [];
	const cached = cache.get(word);
	if (cached) return cached;
	const result = nearestWords(word);
	if (cache.size >= 512) cache.clear();
	cache.set(word, result);
	return result;
}
