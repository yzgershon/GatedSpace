import {
	MODEL_CHOICES,
	type ModelChoice,
	type ModelReport,
} from "./context-report";

export interface ClaudeModelChoice extends ModelChoice {
	resolvedModel?: string;
}

/** Read only the public model metadata from Claude Code's initialize response. */
export function parseClaudeModels(value: unknown): ClaudeModelChoice[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.flatMap((row) => {
		if (!row || typeof row !== "object") return [];
		const { value: id, displayName, description, resolvedModel } = row;
		if (typeof id !== "string" || !id.trim() || seen.has(id)) return [];
		seen.add(id);
		return [
			{
				id,
				label:
					typeof displayName === "string" && displayName ? displayName : id,
				description: typeof description === "string" ? description : "",
				...(typeof resolvedModel === "string" ? { resolvedModel } : {}),
			},
		];
	});
}

/** Unknown models stay selectable; never turn new runtime entries into prose. */
export function claudeModelChoices(
	report?: ModelReport | null,
	catalog?: ClaudeModelChoice[],
): ClaudeModelChoice[] {
	if (catalog?.length) return catalog;
	if (!report?.available.length) return MODEL_CHOICES;
	return [...new Set(report.available)].map(
		(id) =>
			MODEL_CHOICES.find((choice) => choice.id === id) ?? {
				id,
				label: id,
				description: "Available in Claude Code",
			},
	);
}
