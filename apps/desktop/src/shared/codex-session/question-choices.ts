/** Recover only a trailing, explicit question followed by a short list of replies.
 * This creates reply buttons, never an approval or an automatically chosen answer.
 */
export function questionChoices(message: string) {
	if (message.length > 6000 || /```|~~~|^\s*>/m.test(message)) return null;
	const lines = message.trim().split(/\r?\n/);
	const options: string[] = [];
	let index = lines.length - 1;
	for (; index >= 0; index--) {
		const line = lines[index].trim();
		if (!line) continue;
		const match = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
		if (!match) break;
		const label = match[1].replace(/\*\*|__/g, "").trim();
		if (label.length > 200 || /[<>`]|https?:|\]\(/i.test(label)) return null;
		options.unshift(label);
	}
	if (options.length < 2 || options.length > 6) return null;
	const prefix = lines
		.slice(0, index + 1)
		.join("\n")
		.trim();
	const question = prefix
		.split(/\n\s*\n/)
		.at(-1)
		?.replace(/\*\*|__/g, "")
		.trim();
	if (!question || question.length > 700 || !question.endsWith("?"))
		return null;
	if (
		!/\b(which|what|would you|should (?:I|we)|do you|does this|can you|are you|shall (?:I|we))\b/i.test(
			question,
		)
	)
		return null;
	const choices = options.filter(
		(option) => !/^other(?:\b|[.…])/i.test(option),
	);
	if (choices.length < 2 || new Set(choices).size !== choices.length)
		return null;
	return { question, options: choices };
}
