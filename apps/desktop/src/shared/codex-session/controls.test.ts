import { expect, test } from "bun:test";
import {
	defaultCodexEffort,
	isCodexModelError,
	mentionedSkills,
	normalizeCodexLimits,
	normalizeCodexSkills,
	resolveCodexEffort,
} from "./controls";

test("GPT-6.2 choices survive catalog refreshes and valid model changes", () => {
	const model = {
		id: "gpt-6.2-astra",
		name: "GPT-6.2 Astra",
		defaultEffort: "low",
		efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
	};
	for (const effort of model.efforts) {
		expect(resolveCodexEffort(model, effort)).toBe(effort);
		expect(resolveCodexEffort(undefined, effort)).toBe(effort);
	}
	expect(resolveCodexEffort(model)).toBe("xhigh");
	expect(resolveCodexEffort(model, "none")).toBe("xhigh");
	expect(
		resolveCodexEffort({ ...model, efforts: ["low", "medium"] }, "ultra"),
	).toBe("low");
	expect(
		defaultCodexEffort({
			...model,
			defaultEffort: "invalid",
			efforts: ["medium"],
		}),
	).toBe("medium");
});

test("model rejection is distinct from account setup and usage errors", () => {
	expect(
		isCodexModelError(
			`Error running remote compact task: {"error":{"message":"The 'gpt-6.2-astra' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}`,
		),
	).toBe(true);
	expect(isCodexModelError("Model unavailable")).toBe(true);
	expect(isCodexModelError("Authentication expired")).toBe(false);
	expect(isCodexModelError("You've hit your usage limit")).toBe(false);
	expect(isCodexModelError(null)).toBe(false);
});

test("Extra High wins over the CLI default when the model supports it", () => {
	expect(
		defaultCodexEffort({
			id: "astra",
			name: "Astra",
			defaultEffort: "low",
			efforts: ["low", "high", "xhigh", "max"],
		}),
	).toBe("xhigh");
	expect(
		defaultCodexEffort({
			id: "small",
			name: "Small",
			defaultEffort: "medium",
			efforts: ["low", "medium"],
		}),
	).toBe("medium");
});
test("skills are selected only from enabled workspace discovery, with the real path", () => {
	const skills = normalizeCodexSkills({
		data: [
			{
				skills: [
					{
						name: "design",
						path: "/skills/design/SKILL.md",
						description: "UI",
						enabled: true,
					},
					{ name: "secret", path: "/disabled", enabled: false },
				],
			},
		],
	});
	expect(
		mentionedSkills("Use $design, then $design and $secret", skills),
	).toEqual([
		{ type: "skill", name: "design", path: "/skills/design/SKILL.md" },
	]);
	expect(mentionedSkills("$designer $50 $design-other", skills)).toEqual([]);
});
test("usage reads the focused model bucket and never turns unknown into zero", () => {
	const data = {
		rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } },
		rateLimitsByLimitId: {
			codex: {
				primary: { usedPercent: 4, windowDurationMins: 300 },
				secondary: { usedPercent: 16, windowDurationMins: 10080 },
			},
			special: {
				normalModelSlug: "special-model",
				primary: { usedPercent: 54, windowDurationMins: 300 },
			},
		},
	};
	expect(normalizeCodexLimits(data).fiveHourPercent).toBe(4);
	expect(normalizeCodexLimits(data, "special-model").fiveHourPercent).toBe(54);
	expect(normalizeCodexLimits({}).fiveHourPercent).toBeNull();
	expect(
		normalizeCodexLimits({
			rateLimits: { primary: { usedPercent: null, windowDurationMins: 300 } },
		}).fiveHourPercent,
	).toBeNull();
});

test("weekly-only Codex plans show their actual usage and reset instead of unavailable", () => {
	const result = normalizeCodexLimits(
		{
			rateLimitsByLimitId: {
				codex: {
					primary: {
						usedPercent: 25,
						windowDurationMins: 10080,
						resetsAt: 1790474931,
					},
					secondary: null,
				},
			},
		},
		"gpt-6-astra",
	);
	expect(result.fiveHourPercent).toBeNull();
	expect(result.window).toMatchObject({
		usedPercent: 25,
		label: "week",
		description: "weekly window",
	});
	expect(result.window?.resets).toBeTruthy();
});

test("window selection keeps five-hour priority, supports other windows and respects model quotas", () => {
	const primary = { usedPercent: 0, windowDurationMins: 300 };
	const secondary = { usedPercent: 62, windowDurationMins: 10080 };
	expect(
		normalizeCodexLimits({ rateLimits: { primary, secondary } }).window?.label,
	).toBe("5h");
	expect(
		normalizeCodexLimits({ rateLimits: { primary, secondary } }).window
			?.usedPercent,
	).toBe(0);
	expect(
		normalizeCodexLimits({
			rateLimits: { primary: { ...primary, usedPercent: null }, secondary },
		}).window?.label,
	).toBe("week");
	expect(
		normalizeCodexLimits({
			rateLimits: { primary: { usedPercent: 7, windowDurationMins: 60 } },
		}).window,
	).toMatchObject({
		usedPercent: 7,
		label: "1h",
		description: "1-hour window",
	});
	const modelLimits = {
		rateLimitsByLimitId: {
			reserve: { normalModelSlug: "reserve-model", primary: secondary },
			codex: { primary },
		},
	};
	expect(normalizeCodexLimits(modelLimits).window?.usedPercent).toBe(0);
	expect(
		normalizeCodexLimits(modelLimits, "reserve-model").window?.usedPercent,
	).toBe(62);
	for (const invalid of [
		null,
		{},
		{ primary: { usedPercent: NaN, windowDurationMins: 300 } },
		{ primary: { usedPercent: 5, windowDurationMins: 0 } },
	]) {
		expect(normalizeCodexLimits({ rateLimits: invalid }).window).toBeNull();
	}
});
