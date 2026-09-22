import { type CodexModel, list, record, text } from "./types";

export function defaultCodexEffort(model?: CodexModel) {
	if (!model || model.efforts.includes("xhigh")) return "xhigh";
	return model.defaultEffort || model.efforts.at(-1) || "medium";
}

export function normalizeCodexLimits(value: unknown, model?: string) {
	const result = record(value);
	const buckets = record(result.rateLimitsByLimitId);
	const match = model
		? Object.values(buckets).find(
				(bucket) => record(bucket).normalModelSlug === model,
			)
		: undefined;
	const limit = record(match ?? buckets.codex ?? result.rateLimits);
	const windows = [record(limit.primary), record(limit.secondary)];
	const five = windows.find((w) => w.windowDurationMins === 300);
	const weekly = windows.find((w) => w.windowDurationMins === 10080);
	const percent = (w?: Record<string, unknown>) =>
		typeof w?.usedPercent === "number" && Number.isFinite(w.usedPercent)
			? Math.min(100, Math.max(0, w.usedPercent))
			: null;
	const resetLabel = (w?: Record<string, unknown>) => {
		const resetsAt = w?.resetsAt;
		if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return null;
		const date = new Date(resetsAt * 1000);
		return Number.isNaN(date.getTime())
			? null
			: date.toLocaleString(undefined, {
					month: "short",
					day: "numeric",
					hour: "numeric",
					minute: "2-digit",
				});
	};
	// Some plans expose only a weekly window. Prefer five hours when reported,
	// then a week, then another explicit window; never invent a five-hour limit.
	const selected = [five, weekly, ...windows].find(
		(w) =>
			percent(w) !== null &&
			typeof w?.windowDurationMins === "number" &&
			Number.isFinite(w.windowDurationMins) &&
			w.windowDurationMins > 0,
	);
	const minutes = Number(selected?.windowDurationMins);
	const hours = minutes / 60;
	const window = selected
		? {
				usedPercent: percent(selected) as number,
				label:
					minutes === 10080
						? "week"
						: minutes % 60 === 0
							? `${hours}h`
							: `${minutes}m`,
				description:
					minutes === 10080
						? "weekly window"
						: minutes % 60 === 0
							? `${hours}-hour window`
							: `${minutes}-minute window`,
				resets: resetLabel(selected),
			}
		: null;
	return {
		label: "Codex",
		window,
		fiveHourPercent: percent(five),
		weeklyPercent: percent(weekly),
		fiveHourResets: resetLabel(five),
	};
}

export function normalizeCodexSkills(value: unknown) {
	return list(record(value).data)
		.flatMap((row) => list(record(row).skills))
		.map(record)
		.filter((s) => s.enabled === true && text(s.name) && text(s.path))
		.map((s) => ({
			name: text(s.name),
			path: text(s.path),
			description:
				text(record(s.interface).shortDescription) ||
				text(s.shortDescription) ||
				text(s.description),
		}));
}

export function mentionedSkills(
	message: string,
	skills: ReturnType<typeof normalizeCodexSkills>,
) {
	const names = new Set(
		[...message.matchAll(/(?:^|\s)\$([\w.:-]+)(?=$|\s|[,;!?])/g)].map(
			(m) => m[1],
		),
	);
	return skills
		.filter((skill) => names.has(skill.name))
		.map(({ name, path }) => ({ type: "skill" as const, name, path }));
}
