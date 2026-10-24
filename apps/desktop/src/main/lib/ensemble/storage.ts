import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
	type EnsembleGroup,
	ensembleAgreementId,
	ensembleContext,
	memberInput,
} from "../../../shared/ensemble";
import type { EnsembleStorage } from "./engine";

const string = z.string();
const number = z.number();
const savedGroups = z
	.array(
		z.object({
			id: string,
			title: string,
			goal: string,
			criteria: string,
			context: z.array(ensembleContext).max(4).optional(),
			agreements: z.array(ensembleAgreementId).max(4).optional(),
			status: z.enum(["draft", "running", "paused", "stopped", "completed"]),
			commanderId: string,
			members: z
				.array(
					memberInput.extend({ id: string, removed: z.boolean().optional() }),
				)
				.max(100),
			messages: z.array(
				z.object({
					id: string,
					from: string,
					to: string,
					kind: z.enum(["brief", "message", "assignment", "review"]),
					text: string,
					status: z.enum([
						"queued",
						"sending",
						"delivered",
						"answered",
						"uncertain",
						"cancelled",
					]),
					createdAt: number,
					deliveredAt: number.optional(),
					answeredAt: number.optional(),
					reply: string.optional(),
					error: string.optional(),
					actionsApplied: z.boolean().optional(),
					replyTo: string.optional(),
				}),
			),
			tasks: z.array(
				z.object({
					id: string,
					title: string,
					owner: string,
					status: z.enum(["todo", "doing", "review", "done"]),
					dependsOn: z.array(string),
				}),
			),
			artifacts: z.array(
				z.object({
					id: string,
					title: string,
					versions: z.array(
						z.object({
							body: string,
							author: string,
							at: number,
							messageId: string,
						}),
					),
					reviews: z.array(
						z.object({
							author: string,
							text: string,
							version: number,
							at: number,
							messageId: string,
						}),
					),
				}),
			),
			decisions: z.array(
				z.object({ text: string, author: string, at: number }),
			),
			events: z.array(
				z.object({
					id: string,
					at: number,
					kind: z.enum([
						"created",
						"state",
						"delivery",
						"reply",
						"task",
						"artifact",
						"decision",
						"issue",
						"member",
					]),
					text: string,
					memberId: string.optional(),
					messageId: string.optional(),
				}),
			),
			maxMessages: number,
			concurrency: number,
			createdAt: number,
			updatedAt: number,
			result: z
				.object({ text: string, artifactId: string, at: number })
				.optional(),
			issue: string.optional(),
		}),
	)
	.max(40);

/** Caller creates an owner-only directory (secure-file on Windows). */
export class EnsembleFileStorage implements EnsembleStorage {
	private path: string;
	constructor(directory: string) {
		this.path = join(directory, "groups.json");
	}
	load(): EnsembleGroup[] {
		try {
			const file = z
				.object({ version: z.literal(1), groups: savedGroups })
				.parse(JSON.parse(readFileSync(this.path, "utf8")));
			return file.groups;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw new Error(
				"Couldn't read Flock's saved groups. The original file was preserved.",
			);
		}
	}
	save(groups: EnsembleGroup[]) {
		const text = JSON.stringify({ version: 1, groups });
		if (text.length > 25_000_000)
			throw new Error(
				"Flock's local journal reached its 25 MB limit. The previous snapshot is preserved.",
			);
		writeFileSync(`${this.path}.tmp`, text, { mode: 0o600 });
		renameSync(`${this.path}.tmp`, this.path);
	}
}
