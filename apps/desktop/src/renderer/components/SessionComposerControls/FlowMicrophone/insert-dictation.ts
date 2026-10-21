/** If the user typed during dictation, preserve their edits and append. */
export function insertDictation(
	current: string,
	original: { text: string; start: number; end: number },
	words: string,
) {
	if (!words) return current;
	if (current !== original.text)
		return current + (current && !/\s$/.test(current) ? " " : "") + words;
	const before = current.slice(0, original.start),
		after = current.slice(original.end);
	return (
		before +
		(before && !/\s$/.test(before) && !/^\s/.test(words) ? " " : "") +
		words +
		(after && !/^\s/.test(after) && !/\s$/.test(words) ? " " : "") +
		after
	);
}
