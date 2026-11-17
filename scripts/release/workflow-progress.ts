/** Progress is grounded in completed GitHub steps, never a wall-clock animation. */
export function workflowProgress(
	jobs: Array<{
		name?: string;
		status?: string;
		steps?: Array<{ status: string }>;
	}>,
) {
	// The release job appears only after both build jobs finish. Keep a stable
	// denominator instead of jumping backwards when GitHub adds that job.
	const builds = ["x64", "arm64"].map((arch) =>
		jobs.find((job) => job.name?.includes(`Build - Windows (${arch})`)),
	);
	if (builds.some((job) => !job?.steps?.length)) return undefined;
	const steps = builds.flatMap((job) => job?.steps ?? []);
	const releaseDone = jobs.some(
		(job) => job.name === "Create GitHub Release" && job.status === "completed",
	);
	return {
		completed:
			steps.filter((step) => step.status === "completed").length +
			Number(releaseDone),
		// Reserve draft creation and publication; built files are not an update yet.
		total: steps.length + 2,
		basis: "steps" as const,
	};
}
