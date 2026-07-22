import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
	EXTERNAL_APPS,
	NON_EDITOR_APPS,
	projects,
	settings,
} from "@superset/local-db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { clipboard, shell } from "electron";
import { localDb } from "main/lib/local-db";
import { externalUrlLogLabel, isSafeExternalUrl } from "main/lib/safe-url";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { getWorkspace } from "../workspaces/utils/db-helpers";
import { getWorkspacePath } from "../workspaces/utils/worktree";
import {
	type ExternalApp,
	getAppCommand,
	RelativePathWithoutCwdError,
	resolvePath,
	spawnAsync,
} from "./helpers";

/**
 * Wraps a tRPC handler so a `RelativePathWithoutCwdError` (thrown by
 * `resolvePath` when a relative path arrives without a `worktreePath`)
 * surfaces as a clear BAD_REQUEST with the root-cause message instead
 * of a generic 500.
 */
async function withResolveGuard<T>(fn: () => Promise<T> | T): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof RelativePathWithoutCwdError) {
			throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
		}
		throw err;
	}
}

const ExternalAppSchema = z.enum(EXTERNAL_APPS);

/**
 * Clipboard image paste for the terminal.
 *
 * Terminal TUIs (Claude Code, Codex, opencode) attach a screenshot when they
 * receive a bracketed paste containing an image *file path* — the same
 * mechanism VS Code's terminal uses. So on an image-only paste the renderer
 * writes the bitmap to a temp file here and pastes the path, instead of
 * forwarding a bare Ctrl+V (which Claude Code's terminal ignores on Windows —
 * its empty-paste clipboard read only fires on macOS/WSL).
 *
 * The extension must be one Claude Code recognizes as an image
 * (`/\.(png|jpe?g|gif|webp)$/i`); anything else would paste as inert text.
 */
const TERMINAL_IMAGE_MIME_EXT: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

const TERMINAL_IMAGE_DIR = nodePath.join(
	os.tmpdir(),
	"superset-terminal-images",
);
const MAX_TERMINAL_IMAGE_BYTES = 25 * 1024 * 1024;
const TERMINAL_IMAGE_TTL_MS = 60 * 60 * 1000;

/**
 * Best-effort sweep of temp images older than the TTL. The TUI copies the
 * bytes into its own context on paste, so we don't need to keep them around —
 * this just stops the temp dir from growing without bound.
 */
async function pruneOldTerminalImages(dir: string): Promise<void> {
	try {
		const now = Date.now();
		const entries = await fs.promises.readdir(dir);
		await Promise.all(
			entries.map(async (name) => {
				const full = nodePath.join(dir, name);
				try {
					const stat = await fs.promises.stat(full);
					if (now - stat.mtimeMs > TERMINAL_IMAGE_TTL_MS) {
						await fs.promises.rm(full, { force: true });
					}
				} catch {
					// Ignore individual file races (already removed, locked, etc.).
				}
			}),
		);
	} catch {
		// Dir doesn't exist yet or can't be read — nothing to prune.
	}
}

const nonEditorSet = new Set<ExternalApp>(NON_EDITOR_APPS);

/** Sets the global default editor if one hasn't been set yet. Skips non-editor apps. */
function ensureGlobalDefaultEditor(app: ExternalApp) {
	if (nonEditorSet.has(app)) return;

	const row = localDb.select().from(settings).get();
	if (!row?.defaultEditor) {
		localDb
			.insert(settings)
			.values({ id: 1, defaultEditor: app })
			.onConflictDoUpdate({
				target: settings.id,
				set: { defaultEditor: app },
			})
			.run();
	}
}

/** Resolves the default editor from project setting, then global setting. */
export function resolveDefaultEditor(projectId?: string): ExternalApp | null {
	if (projectId) {
		const project = localDb
			.select()
			.from(projects)
			.where(eq(projects.id, projectId))
			.get();
		if (project?.defaultApp) return project.defaultApp;
	}
	const row = localDb.select().from(settings).get();
	return row?.defaultEditor ?? null;
}

async function openPathInApp(
	filePath: string,
	app: ExternalApp,
): Promise<void> {
	if (app === "finder") {
		shell.showItemInFolder(filePath);
		return;
	}

	const candidates = getAppCommand(app, filePath);
	if (candidates) {
		let lastError: Error | undefined;
		for (const cmd of candidates) {
			try {
				await spawnAsync(cmd.command, cmd.args);
				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				if (candidates.length > 1) {
					console.warn(
						`[external/openInApp] ${cmd.args[1]} not found, trying next candidate`,
					);
				}
			}
		}
		throw lastError;
	}

	await shell.openPath(filePath);
}

/**
 * External operations router.
 * Handles opening URLs and files in external applications.
 */
export const createExternalRouter = () => {
	return router({
		openUrl: publicProcedure.input(z.string()).mutation(async ({ input }) => {
			if (!isSafeExternalUrl(input)) {
				console.warn(
					"[external/openUrl] Blocked unsafe URL scheme:",
					externalUrlLogLabel(input),
				);
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "URL scheme not allowed",
				});
			}
			try {
				await shell.openExternal(input);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				console.error(
					"[external/openUrl] Failed to open URL:",
					externalUrlLogLabel(input),
					error,
				);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: errorMessage,
				});
			}
		}),

		openInFinder: publicProcedure
			.input(z.string())
			.mutation(async ({ input }) => {
				shell.showItemInFolder(input);
			}),

		openInApp: publicProcedure
			.input(
				z.object({
					path: z.string(),
					app: ExternalAppSchema,
					projectId: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				// openInApp hands `path` directly to the editor CLI / shell; with no
				// cwd input there's no safe way to interpret a relative path, so we
				// reject them loudly instead of silently resolving against Electron's
				// working directory.
				if (!nodePath.isAbsolute(input.path)) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `openInApp requires an absolute path (got ${JSON.stringify(input.path)}).`,
					});
				}
				await openPathInApp(input.path, input.app);

				// Persist defaults only after successful launch
				if (input.projectId) {
					localDb
						.update(projects)
						.set({ defaultApp: input.app })
						.where(eq(projects.id, input.projectId))
						.run();
				}

				// Auto-set global default editor on first successful use (best-effort)
				try {
					ensureGlobalDefaultEditor(input.app);
				} catch (err) {
					console.warn(
						"[external/openInApp] Failed to persist global default editor:",
						err,
					);
				}
			}),

		copyPath: publicProcedure.input(z.string()).mutation(async ({ input }) => {
			clipboard.writeText(input);
		}),

		copyText: publicProcedure.input(z.string()).mutation(async ({ input }) => {
			clipboard.writeText(input);
		}),

		resolvePath: publicProcedure
			.input(
				z.object({
					path: z.string(),
					/** Absolute workspace worktree path — relative `path`s are resolved against this. */
					worktreePath: z.string().optional(),
				}),
			)
			.query(({ input }) =>
				withResolveGuard(() => resolvePath(input.path, input.worktreePath)),
			),

		statPath: publicProcedure
			.input(
				z.object({
					path: z.string(),
					workspaceId: z.string().optional(),
				}),
			)
			.mutation(({ input }) =>
				withResolveGuard(async () => {
					const workspace = input.workspaceId
						? getWorkspace(input.workspaceId)
						: null;
					const cwd = workspace
						? (getWorkspacePath(workspace) ?? undefined)
						: undefined;
					const resolved = resolvePath(input.path, cwd);
					try {
						const stats = await fs.promises.stat(resolved);
						return {
							isDirectory: stats.isDirectory(),
							resolvedPath: resolved,
						};
					} catch {
						return null;
					}
				}),
			),

		openFileInEditor: publicProcedure
			.input(
				z.object({
					path: z.string(),
					line: z.number().optional(),
					column: z.number().optional(),
					/**
					 * Absolute workspace worktree path. Required when `path` is
					 * relative; ignored when `path` is already absolute. Using the
					 * workspace's worktreePath (rather than an arbitrary cwd) means
					 * relative diff/tree paths always resolve against the workspace
					 * the user is in, never Electron's process cwd.
					 */
					worktreePath: z.string().optional(),
					projectId: z.string().optional(),
					/**
					 * Explicit app override from the caller (e.g. the v2 CMD+O
					 * choice stored client-side in tanstack-db). When provided,
					 * bypasses the server-side `resolveDefaultEditor` lookup —
					 * which only knows about v1 localDb tables and would
					 * otherwise return a stale global default for v2 projects.
					 */
					app: ExternalAppSchema.optional(),
				}),
			)
			.mutation(({ input }) =>
				withResolveGuard(async () => {
					const filePath = resolvePath(input.path, input.worktreePath);
					const app = input.app ?? resolveDefaultEditor(input.projectId);

					if (!app) {
						// No preferred editor configured yet.
						// Fall back to OS default file handler so Cmd/Ctrl+click still works
						// even when Cursor (or any specific editor) isn't installed.
						await shell.openPath(filePath);
						return;
					}

					await openPathInApp(filePath, app);
				}),
			),

		/**
		 * Persist a pasted clipboard image to a temp file and return its absolute
		 * path, so the renderer can bracketed-paste that path into the terminal.
		 * See TERMINAL_IMAGE_MIME_EXT above for the why.
		 */
		saveTerminalImage: publicProcedure
			.input(
				z.object({
					/** Raw image bytes, base64-encoded (no data-URL prefix). */
					base64: z.string().min(1),
					/** Source MIME type, e.g. "image/png". */
					mimeType: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const ext = TERMINAL_IMAGE_MIME_EXT[input.mimeType.toLowerCase()];
				if (!ext) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Unsupported clipboard image type: ${input.mimeType}`,
					});
				}

				const buffer = Buffer.from(input.base64, "base64");
				if (buffer.byteLength === 0) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Clipboard image is empty",
					});
				}
				if (buffer.byteLength > MAX_TERMINAL_IMAGE_BYTES) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Clipboard image is too large",
					});
				}

				await fs.promises.mkdir(TERMINAL_IMAGE_DIR, { recursive: true });
				await pruneOldTerminalImages(TERMINAL_IMAGE_DIR);

				const suffix = Math.random().toString(36).slice(2, 10);
				const fileName = `paste-${Date.now()}-${suffix}.${ext}`;
				const filePath = nodePath.join(TERMINAL_IMAGE_DIR, fileName);
				await fs.promises.writeFile(filePath, buffer);

				return { path: filePath };
			}),
	});
};

export type ExternalRouter = ReturnType<typeof createExternalRouter>;
