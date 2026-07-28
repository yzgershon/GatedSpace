import { openElevatedTerminal } from "main/lib/elevated-terminal";
import { FOCUS_SURFACES, writeFocusSurface } from "main/lib/focus-surface-file";
import { z } from "zod";
import { publicProcedure, router } from "..";
import { execWithShellEnv } from "./workspaces/utils/shell-env";

interface GhDetectResult {
	installed: boolean;
	authenticated: boolean;
	version: string | null;
	path: string | null;
}

async function detectGhCli(): Promise<GhDetectResult> {
	// Resolve `gh` via the user's login-shell PATH (execWithShellEnv retries with
	// the derived shell env on ENOENT), so we find it wherever it's installed —
	// homebrew, MacPorts, nix, asdf, etc. — not just a hardcoded path list.
	let version: string | null = null;
	try {
		const { stdout } = await execWithShellEnv("gh", ["--version"], {
			timeout: 5000,
		});
		const firstLine = stdout.split("\n")[0]?.trim() ?? "";
		version = firstLine.match(/gh version (\S+)/)?.[1] ?? null;
	} catch {
		return {
			installed: false,
			authenticated: false,
			version: null,
			path: null,
		};
	}

	let authenticated = false;
	try {
		await execWithShellEnv(
			"gh",
			["auth", "status", "--active", "--hostname", "github.com"],
			{ timeout: 5000 },
		);
		authenticated = true;
	} catch {
		// `gh auth status` exits non-zero when not logged in.
	}

	return { installed: true, authenticated, version, path: "gh" };
}

export const createSystemRouter = () => {
	return router({
		detectGhCli: publicProcedure.query(detectGhCli),
		/**
		 * Opens an admin shell in its OWN window — see `elevated-terminal.ts` for
		 * why it cannot be a pane. Reports failure in the result rather than
		 * throwing: declining the Windows prompt is a decision, not an error.
		 */
		openElevatedTerminal: publicProcedure
			.input(z.object({ cwd: z.string().default("") }))
			.mutation(({ input }) => openElevatedTerminal(input.cwd)),
		supportsElevatedTerminal: publicProcedure.query(
			() => process.platform === "win32",
		),
		/**
		 * Publishes what kind of element has focus, for GatedVoice to read.
		 * Fire-and-forget: a failed hint costs the old typing behaviour, so it
		 * must never make the renderer's focus handling throw.
		 */
		setFocusSurface: publicProcedure
			.input(
				z.object({
					surface: z.enum(FOCUS_SURFACES as [string, ...string[]]),
				}),
			)
			.mutation(({ input }) => {
				writeFocusSurface(input.surface as "terminal" | "text" | "other");
				return { ok: true };
			}),
	});
};

export type SystemRouter = ReturnType<typeof createSystemRouter>;
