// A small set of unambiguous mistakes also works before the local dictionary
// has loaded. Everything else must have one unique, very close dictionary match.
const COMMON: Record<string, string> = {
	teh: "the",
	thier: "their",
	becuase: "because",
	becasue: "because",
	recieve: "receive",
	recieved: "received",
	seperate: "separate",
	seperately: "separately",
	definitly: "definitely",
	definately: "definitely",
	occured: "occurred",
	accomodate: "accommodate",
	wierd: "weird",
	untill: "until",
	alot: "a lot",
	everytime: "every time",
	cuttoff: "cutoff",
	whats: "what's",
	doesnt: "doesn't",
	dont: "don't",
	isnt: "isn't",
	didnt: "didn't",
	couldnt: "couldn't",
	wouldnt: "wouldn't",
	shouldnt: "shouldn't",
	havent: "haven't",
	hasnt: "hasn't",
	im: "I'm",
	ive: "I've",
	youre: "you're",
};

/** One insertion, deletion, substitution or adjacent transposition. */
function oneEdit(a: string, b: string): boolean {
	if (a === b || Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
	if (a.length === b.length)
		return (
			a.slice(i + 1) === b.slice(i + 1) ||
			(a[i] === b[i + 1] &&
				a[i + 1] === b[i] &&
				a.slice(i + 2) === b.slice(i + 2))
		);
	return a.length > b.length
		? a.slice(i + 1) === b.slice(i)
		: a.slice(i) === b.slice(i + 1);
}

export function getAutocorrection(
	text: string,
	caret: number,
	suggestions: (word: string) => string[] = () => [],
) {
	const prefix = text.slice(0, caret);
	const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
	// Avoid fenced/inline code, shell commands, indented code and quoted literals.
	if (
		(prefix.match(/```|~~~/g)?.length ?? 0) % 2 ||
		(line.match(/`/g)?.length ?? 0) % 2 ||
		/^\s*(?:[/@$]|>|\w+\s*[=(]|(?:const|let|var|import|export|return|git|npm|bun|python|node|cd|rg)\b)/.test(
			line,
		) ||
		/^(?: {4}|\t)/.test(line) ||
		(line.match(/"/g)?.length ?? 0) % 2
	)
		return null;
	const match = /(?:^|\s)([A-Za-z]{2,32})$/.exec(prefix);
	if (!match || /[\w./\\@#$-]/.test(text[caret] ?? "")) return null;
	const word = match[1];
	// Respect names, acronyms and mixed-case identifiers.
	if (word !== word.toLowerCase()) return null;
	let replacement = COMMON[word];
	if (!replacement && word.length >= 4) {
		const close = [...new Set(suggestions(word))].filter(
			(candidate) => /^[a-z]+$/.test(candidate) && oneEdit(word, candidate),
		);
		if (close.length === 1) replacement = close[0];
	}
	return replacement ? { start: caret - word.length, word, replacement } : null;
}
