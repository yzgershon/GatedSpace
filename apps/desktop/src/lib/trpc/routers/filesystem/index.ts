import { toErrorMessage } from "@superset/workspace-fs/host";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import {
	getServiceForRootPath,
	getServiceForWorkspace,
} from "../workspace-fs-service";
import { type FileSessionScope, sessionFileRoot } from "./session-file-scope";

const sessionScopeSchema = z.object({
	provider: z.enum(["codex", "claude"]),
	key: z.string().min(1).max(200),
});

async function getReadService(input: {
	workspaceId: string;
	absolutePath: string;
	session?: FileSessionScope;
}) {
	if (!input.session) return getServiceForWorkspace(input.workspaceId);
	const session = input.session;
	const cwd =
		session.provider === "codex"
			? (
					await import("main/lib/codex-session/session-manager")
				).codexSessionManager.get(session.key)?.cwd
			: (
					await import("main/lib/claude-session/session-manager")
				).claudeSessionManager.getContext(session.key)?.cwd;
	return getServiceForRootPath(
		await sessionFileRoot(session, input.absolutePath, () => cwd),
	);
}

function isClosedStreamError(error: unknown): boolean {
	return (
		error instanceof TypeError &&
		"code" in error &&
		error.code === "ERR_INVALID_STATE"
	);
}

const writeFileContentSchema = z.union([
	z.string(),
	z.object({
		kind: z.literal("base64"),
		data: z.string(),
	}),
]);

type WatchPathEventBatch = {
	events: Array<{
		kind: string;
		absolutePath: string;
		oldAbsolutePath?: string;
	}>;
};

export const createFilesystemRouter = () => {
	return router({
		listDirectory: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					absolutePath: z.string(),
				}),
			)
			.query(async ({ input }) => {
				const service = getServiceForWorkspace(input.workspaceId);
				return await service.listDirectory({
					absolutePath: input.absolutePath,
				});
			}),

		readFile: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					session: sessionScopeSchema.optional(),
					absolutePath: z.string(),
					offset: z.number().optional(),
					maxBytes: z.number().optional(),
					encoding: z.string().optional(),
				}),
			)
			.query(async ({ input }) => {
				const service = await getReadService(input);
				const result = await service.readFile({
					absolutePath: input.absolutePath,
					offset: input.offset,
					maxBytes: input.maxBytes,
					encoding: input.encoding,
				});

				if (result.kind === "bytes") {
					return {
						...result,
						content: Buffer.from(result.content).toString("base64"),
					};
				}

				return result;
			}),

		getMetadata: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					absolutePath: z.string(),
				}),
			)
			.query(async ({ input }) => {
				const service = getServiceForWorkspace(input.workspaceId);
				return await service.getMetadata({
					absolutePath: input.absolutePath,
				});
			}),

		writeFile: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					absolutePath: z.string(),
					content: writeFileContentSchema,
					encoding: z.string().optional(),
					options: z
						.object({
							create: z.boolean(),
							overwrite: z.boolean(),
						})
						.optional(),
					precondition: z
						.object({
							ifMatch: z.string(),
						})
						.optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const service = getServiceForWorkspace(input.workspaceId);
				const content =
					typeof input.content === "string"
						? input.content
						: new Uint8Array(Buffer.from(input.content.data, "base64"));

				return await service.writeFile({
					absolutePath: input.absolutePath,
					content,
					encoding: input.encoding,
					options: input.options,
					precondition: input.precondition,
				});
			}),

		createDirectory: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					absolutePath: z.string(),
					recursive: z.boolean().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const service = getServiceForWorkspace(input.workspaceId);
				return await service.createDirectory({
					absolutePath: input.absolutePath,
					recursive: input.recursive,
				});
			}),

		deletePath: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					absolutePath: z.string(),
					permanent: z.boolean().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const service = getServiceForWorkspace(input.workspaceId);
				return await service.deletePath({
					absolutePath: input.absolutePath,
					permanent: input.permanent,
				});
			}),

		movePath: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					sourceAbsolutePath: z.string(),
					destinationAbsolutePath: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const service = getServiceForWorkspace(input.workspaceId);
				return await service.movePath({
					sourceAbsolutePath: input.sourceAbsolutePath,
					destinationAbsolutePath: input.destinationAbsolutePath,
				});
			}),

		copyPath: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					sourceAbsolutePath: z.string(),
					destinationAbsolutePath: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const service = getServiceForWorkspace(input.workspaceId);
				return await service.copyPath({
					sourceAbsolutePath: input.sourceAbsolutePath,
					destinationAbsolutePath: input.destinationAbsolutePath,
				});
			}),

		searchFiles: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					query: z.string(),
					includeHidden: z.boolean().optional(),
					includePattern: z.string().optional(),
					excludePattern: z.string().optional(),
					limit: z.number().optional(),
				}),
			)
			.query(async ({ input }) => {
				const trimmedQuery = input.query.trim();
				if (!trimmedQuery) {
					return { matches: [] };
				}

				const service = getServiceForWorkspace(input.workspaceId);
				return await service.searchFiles({
					query: trimmedQuery,
					includeHidden: input.includeHidden,
					includePattern: input.includePattern,
					excludePattern: input.excludePattern,
					limit: input.limit,
				});
			}),

		searchContent: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					query: z.string(),
					includeHidden: z.boolean().optional(),
					includePattern: z.string().optional(),
					excludePattern: z.string().optional(),
					limit: z.number().optional(),
				}),
			)
			.query(async ({ input }) => {
				const trimmedQuery = input.query.trim();
				if (!trimmedQuery) {
					return { matches: [] };
				}

				const service = getServiceForWorkspace(input.workspaceId);
				return await service.searchContent({
					query: trimmedQuery,
					includeHidden: input.includeHidden,
					includePattern: input.includePattern,
					excludePattern: input.excludePattern,
					limit: input.limit,
				});
			}),

		watchPath: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					session: sessionScopeSchema.optional(),
					absolutePath: z.string(),
					recursive: z.boolean().optional(),
				}),
			)
			.subscription(({ input }) => {
				return observable<WatchPathEventBatch>((emit) => {
					let isDisposed = false;
					let iterator: AsyncIterator<WatchPathEventBatch> | undefined;

					const runCleanup = () => {
						isDisposed = true;
						void iterator?.return?.().catch((error) => {
							console.error("[filesystem/watchPath] Cleanup failed:", {
								workspaceId: input.workspaceId,
								error,
							});
						});
					};

					const emitIfOpen = (value: WatchPathEventBatch): boolean => {
						try {
							emit.next(value);
							return true;
						} catch (error) {
							if (isClosedStreamError(error)) {
								runCleanup();
								return false;
							}

							throw error;
						}
					};

					void (async () => {
						try {
							const service = await getReadService(input);
							if (isDisposed) return;
							iterator = service
								.watchPath({
									absolutePath: input.absolutePath,
									recursive: input.recursive,
								})
								[Symbol.asyncIterator]();
							while (!isDisposed) {
								const next = await iterator.next();
								if (next.done || isDisposed) {
									return;
								}

								if (!emitIfOpen(next.value)) {
									return;
								}
							}
						} catch (error) {
							if (isDisposed) return;
							console.error("[filesystem/watchPath] Failed:", {
								workspaceId: input.workspaceId,
								error: toErrorMessage(error),
							});

							if (input.session) {
								emit.error(
									error instanceof Error
										? error
										: new Error(toErrorMessage(error)),
								);
							} else {
								// Preserve the existing overflow contract for workspace clients.
								emitIfOpen({
									events: [
										{ kind: "overflow", absolutePath: input.absolutePath },
									],
								});
							}
							runCleanup();
						}
					})();

					return () => {
						runCleanup();
					};
				});
			}),
	});
};
