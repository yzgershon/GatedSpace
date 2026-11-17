import { z } from "zod";

export const buildIdSchema = z
	.string()
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const buildJobSchema = z
	.object({
		id: buildIdSchema,
		version: z.string().regex(/^\d+\.\d+\.\d+$/),
		channel: z.enum(["personal", "public"]),
		architectures: z
			.array(z.enum(["arm64", "x64"]))
			.min(1)
			.max(2),
		sourceCommit: z.string().regex(/^[a-f0-9]{7,40}$/),
		stage: z.enum(["building", "verifying", "ready", "failed"]),
		message: z.string().max(500),
		updatedAt: z.string().datetime(),
		verified: z.boolean().default(false),
		published: z.boolean().default(false),
		url: z.string().url().optional(),
		progress: z
			.object({
				completed: z.number().finite().min(0),
				total: z.number().finite().positive(),
				basis: z.enum(["steps", "timing-estimate"]).optional(),
				// Present only when previous measured phase timings are available.
				estimatedRemainingMs: z.number().finite().nonnegative().optional(),
			})
			.refine((p) => p.completed <= p.total)
			.optional(),
	})
	.superRefine((job, ctx) => {
		if (
			job.stage === "ready" &&
			(!job.verified || (job.channel === "public" && !job.published))
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"Ready requires verified installers and, for public builds, publication.",
			});
		}
		if (job.url && !isBuildUrl(job.url)) {
			ctx.addIssue({
				code: "custom",
				message: "Expected a GatedSpace release or workflow URL.",
			});
		}
	});

export function isBuildUrl(value: string): boolean {
	return /^https:\/\/github\.com\/yzgershon\/GatedSpace\/(?:actions\/runs\/\d+|releases\/tag\/desktop-v\d+\.\d+\.\d+)$/.test(
		value,
	);
}

export type BuildJob = z.infer<typeof buildJobSchema>;
export function buildProgress(job: BuildJob): number | undefined {
	if (job.stage === "ready") return 100;
	if (!job.progress) return undefined;
	return Math.min(
		99,
		Math.floor((100 * job.progress.completed) / job.progress.total),
	);
}
export function buildProgressLabel(job: BuildJob): string {
	const progress = buildProgress(job);
	const remaining = job.progress?.estimatedRemainingMs;
	return [
		progress === undefined
			? "Progress not reported yet"
			: `${progress}% ${job.progress?.basis === "timing-estimate" ? "estimated build progress" : "of build steps complete"}`,
		remaining === undefined
			? null
			: `About ${Math.max(1, Math.ceil(remaining / 60_000))} min remaining (estimate)`,
	]
		.filter(Boolean)
		.join(" · ");
}
export const isBuildActive = (job: BuildJob) =>
	job.stage === "building" || job.stage === "verifying";
/** History stays in the popover. An old failure must not mask a new running/ready job. */
export function primaryBuild(jobs: BuildJob[]) {
	const recent = [...jobs].sort((a, b) =>
		b.updatedAt.localeCompare(a.updatedAt),
	);
	return recent.find(isBuildActive) ?? recent[0];
}
export const buildRevision = (job: BuildJob) => `${job.updatedAt}:${job.stage}`;
export const BUILD_STAGE_LABELS = {
	building: "Building",
	verifying: "Verifying",
	ready: "Ready",
	failed: "Needs attention",
} as const;
