/** Create only the empty checkpoint needed for workspaces. Never include files
 * the user has staged unless explicitly creating a template snapshot. Does not
 * change their Git config or require a signing key. */
export async function ensureInitialGitCommit(
	git: {
		raw(args: string[]): Promise<string>;
	},
	options: { includeTemplateFiles?: boolean } = {},
): Promise<void> {
	try {
		await git.raw(["rev-parse", "--verify", "HEAD"]);
		return;
	} catch {
		// Unborn branch: create its first checkpoint.
	}
	const args = [
		"commit",
		...(options.includeTemplateFiles ? [] : ["--only"]),
		"--allow-empty",
		"--no-gpg-sign",
		"-m",
		"Initial commit",
	];
	try {
		await git.raw(args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			!/empty ident|user\.email|user\.name|unable to auto-detect email/i.test(
				message,
			)
		)
			throw error;
		await git.raw([
			"-c",
			"user.name=GatedSpace",
			"-c",
			"user.email=noreply@gatedspace.local",
			...args,
		]);
	}
}
