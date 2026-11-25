import { randomUUID } from "node:crypto";
import { readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { z } from "zod";
import { SUPERSET_HOME_DIR } from "../app-environment";
import { ensureSecureDir, writeSecureFile } from "../secure-file";
import { HubConflict, MobileHubStore } from "./hub-store";
import { mobileMarkdown } from "./message-format";

const directory = join(SUPERSET_HOME_DIR, "mobile-workspace");
const file = join(directory, "workspace.json");
const store = new MobileHubStore({
	async load() {
		try {
			return JSON.parse(await readFile(file, "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	},
	async save(state) {
		ensureSecureDir(directory);
		const temporary = join(directory, `${randomUUID()}.tmp`);
		try {
			writeSecureFile(temporary, JSON.stringify(state));
			await rename(temporary, file);
		} finally {
			await unlink(temporary).catch(() => {});
		}
	},
});

/** Mount behind the bridge authentication gate and its 64 KiB JSON parser. */
export function mobileHubRouter(hub = store) {
	const router = express.Router();
	const handle =
		(
			action: (req: express.Request, res: express.Response) => Promise<unknown>,
		) =>
		(req: express.Request, res: express.Response) => {
			void action(req, res).catch((error: unknown) => {
				res
					.status(
						error instanceof z.ZodError
							? 400
							: error instanceof HubConflict
								? 409
								: 500,
					)
					.json({
						error:
							error instanceof z.ZodError
								? "Check the title and content, then try again."
								: error instanceof HubConflict
									? error.message
									: "Could not load or save your mobile workspace. Your existing data has been kept.",
					});
			});
		};
	router.get(
		"/",
		handle(async (_req, res) =>
			res.json({
				...(await hub.list()),
				execution: "desktop",
				cloudAvailable: false,
			}),
		),
	);
	router.get(
		"/outputs/:id",
		handle(async (req, res) => {
			const output = await hub.get("outputs", String(req.params.id));
			res.json({ ...output, html: mobileMarkdown(output.body) });
		}),
	);
	router.post(
		"/references",
		handle(async (req, res) => res.json(await hub.resolveReference(req.body))),
	);
	router.post(
		"/:kind",
		handle(async (req, res) => {
			const kind = z
				.enum(["channels", "tasks", "outputs"])
				.parse(req.params.kind);
			res.json(await hub.write(kind, req.body));
		}),
	);
	router.patch(
		"/:kind/:id",
		handle(async (req, res) => {
			const kind = z
				.enum(["channels", "tasks", "outputs"])
				.parse(req.params.kind);
			const { expectedVersion, ...data } = z
				.object({ expectedVersion: z.number().int().positive() })
				.passthrough()
				.parse(req.body);
			res.json(
				await hub.write(
					kind,
					{ ...data, id: String(req.params.id) },
					expectedVersion,
				),
			);
		}),
	);
	return router;
}
