import { dialog, shell } from "electron";
import { syncConnection, syncTransfers } from "main/lib/continuity";
import { transferableSessions } from "main/lib/continuity/native-sessions";
import { writeSecureFile } from "main/lib/secure-file/secure-file";
import { z } from "zod";
import { publicProcedure, router } from "..";

export const createContinuityRouter = () =>
	router({
		status: publicProcedure.query(() => syncConnection.status()),
		transferStatus: publicProcedure.query(() => syncTransfers.status()),
		sessions: publicProcedure.query(() =>
			transferableSessions().map(({ sessionId, title, provider, cwd }) => ({
				sessionId,
				title,
				provider,
				cwd,
			})),
		),
		available: publicProcedure.query(() => syncTransfers.available()),
		send: publicProcedure
			.input(
				z.object({
					provider: z.enum(["codex", "claude"]),
					sessionId: z.uuid(),
				}),
			)
			.mutation(async ({ input }) => {
				const result = await dialog.showOpenDialog({
					title:
						"Choose the specific Git project to sync with this conversation",
					properties: ["openDirectory"],
				});
				if (result.canceled || !result.filePaths[0]) return { canceled: true };
				const transferResult = await syncTransfers.send(
					input.provider,
					input.sessionId,
					result.filePaths[0],
				);
				return { canceled: false, result: transferResult };
			}),
		retry: publicProcedure.mutation(() => syncTransfers.retry()),
		syncNow: publicProcedure
			.input(z.object({ streamId: z.uuid() }))
			.mutation(({ input }) => syncTransfers.syncNow(input.streamId)),
		restore: publicProcedure
			.input(
				z.object({
					streamId: z.uuid(),
					folderName: z.string().min(1).max(100),
				}),
			)
			.mutation(async ({ input }) => {
				const result = await dialog.showOpenDialog({
					title: "Choose a parent folder for the restored project",
					properties: ["openDirectory", "createDirectory"],
				});
				if (result.canceled || !result.filePaths[0]) return null;
				return syncTransfers.restore(
					input.streamId,
					result.filePaths[0],
					input.folderName,
				);
			}),
		automatic: publicProcedure
			.input(z.object({ streamId: z.uuid(), enabled: z.boolean() }))
			.mutation(({ input }) =>
				syncTransfers.setAutomatic(input.streamId, input.enabled),
			),
		connect: publicProcedure.mutation(() => {
			if (syncTransfers.status().busy)
				throw new Error(
					"Wait for the transfer to finish before changing the account connection.",
				);
			return syncConnection.begin();
		}),
		openSignIn: publicProcedure.mutation(async () => {
			const pending = syncConnection.status().pending;
			if (!pending || pending.expiresAt <= Date.now())
				throw new Error("Start a new connection request.");
			await shell.openExternal(pending.url);
		}),
		cancel: publicProcedure.mutation(() => {
			syncConnection.cancel();
			return syncConnection.status();
		}),
		disconnect: publicProcedure.mutation(() => {
			if (syncTransfers.status().busy)
				throw new Error(
					"Wait for the transfer to finish before disconnecting.",
				);
			return syncConnection.disconnect();
		}),
		setRecoveryKey: publicProcedure
			.input(z.object({ key: z.string().trim().min(43).max(43).optional() }))
			.mutation(({ input }) => syncConnection.setRecoveryKey(input.key)),
		exportRecoveryKey: publicProcedure.mutation(async () => {
			const key = syncConnection.recoveryKey();
			const { canceled, filePath } = await dialog.showSaveDialog({
				title: "Save your GatedSpace recovery key",
				defaultPath: "GatedSpace-recovery-key.txt",
				filters: [{ name: "Recovery key", extensions: ["txt"] }],
			});
			if (canceled || !filePath) return { saved: false };
			writeSecureFile(
				filePath,
				`GatedSpace Sync recovery key\nKeep this private. Enter it on your other PC; never share it in chat.\n\n${key}\n`,
			);
			return { saved: true };
		}),
	});
