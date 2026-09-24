import { z } from "zod";

export const CHUNK_BYTES = 512 * 1024;
export const MAX_CHECKPOINT_BYTES = 256 * 1024 * 1024;
export const MAX_ACCOUNT_BYTES = 1024 * 1024 * 1024;
export const LEASE_SECONDS = 120;
export const SYNC_CLIENT_ID = "gatedspace-desktop";

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const idSchema = z.string().uuid();
export const chunkSchema = z
	.object({
		id: digestSchema,
		bytes: z
			.number()
			.int()
			.min(29)
			.max(CHUNK_BYTES + 29),
	})
	.strict();
export const manifestSchema = z
	.object({
		version: z.literal(1),
		chunks: z.array(chunkSchema).min(1).max(513),
	})
	.strict()
	.refine(
		(value) =>
			value.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) <=
			MAX_CHECKPOINT_BYTES + 513 * 29,
		"Checkpoint exceeds the size limit",
	);
export type CheckpointManifest = z.infer<typeof manifestSchema>;

export const publishSchema = z
	.object({
		id: idSchema,
		deviceId: idSchema,
		baseRevision: z.number().int().nonnegative(),
		leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
		fence: z.number().int().positive(),
		manifest: manifestSchema,
	})
	.strict();
export type PublishCheckpoint = z.infer<typeof publishSchema>;

export interface StreamHead {
	id: string;
	revision: number;
	checkpointId: string | null;
	deviceId: string | null;
	leaseExpiresAt: string | null;
	updatedAt: string;
}

/** Windows-safe relative paths, including when a checkpoint originated on Linux. */
export function safeRelativePath(value: string): boolean {
	if (
		!value ||
		value.length > 1024 ||
		value.includes("\\") ||
		value.startsWith("/")
	)
		return false;
	return value
		.split("/")
		.every(
			(part) =>
				!!part &&
				part !== "." &&
				part !== ".." &&
				!/[<>:"|?*]/.test(part) &&
				!Array.from(part).some((char) => char.charCodeAt(0) < 32) &&
				!/[. ]$/.test(part) &&
				!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
		);
}

export function excludedProjectPath(value: string): boolean {
	if (!safeRelativePath(value)) return true;
	return value
		.split("/")
		.some(
			(part, index, parts) =>
				/^(\.git|\.gatedspace-sync|node_modules|\.next|\.turbo|\.cache|\.ssh|\.aws|\.azure|\.gnupg)$/i.test(
					part,
				) ||
				/^\.env(?:\.|$)/i.test(part) ||
				(index === parts.length - 1 &&
					/^(credentials|auth|tokens?)(?:\.json)?$/i.test(part)) ||
				/^(\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_rsa|id_ed25519|id_ecdsa)$/i.test(
					part,
				) ||
				/\.(pem|key|p12|pfx|kdbx)$/i.test(part),
		);
}

export const portableFileSchema = z
	.object({
		path: z.string().refine(safeRelativePath, "Unsafe relative file path"),
		content: z.string(),
		sha256: digestSchema,
		executable: z.boolean().default(false),
	})
	.strict();

/** This entire payload is encrypted before it leaves a PC. */
export const checkpointSchema = z
	.object({
		version: z.literal(1),
		streamId: idSchema,
		createdAt: z.string().datetime(),
		project: z
			.object({
				name: z.string().min(1).max(200),
				gitRemote: z.string().max(2048).nullable(),
				gitCommit: z
					.string()
					.regex(/^[a-f0-9]{40,64}$/)
					.nullable(),
				files: z.array(portableFileSchema).max(20_000),
			})
			.strict(),
		session: z
			.object({
				provider: z.enum(["codex", "claude"]),
				title: z.string().max(1000),
				originalId: z.string().min(1).max(200),
				originalCwd: z.string().min(1).max(4096),
				format: z.enum(["codex-rollout-v1", "claude-jsonl-v1"]),
				transcript: z.string().min(1),
				attachments: z.array(portableFileSchema).max(1000),
			})
			.strict(),
	})
	.strict()
	.superRefine((value, ctx) => {
		const expected =
			value.session.provider === "codex"
				? "codex-rollout-v1"
				: "claude-jsonl-v1";
		if (value.session.format !== expected)
			ctx.addIssue({
				code: "custom",
				message: "Provider and transcript format differ",
			});
		const paths = new Set<string>();
		for (const file of value.project.files) {
			const path = file.path.toLocaleLowerCase("en-US");
			if (paths.has(path) || excludedProjectPath(file.path))
				ctx.addIssue({
					code: "custom",
					message: "Duplicate or excluded project path",
				});
			paths.add(path);
		}
		const attachmentPaths = new Set<string>();
		for (const file of value.session.attachments) {
			const path = file.path.toLowerCase();
			if (attachmentPaths.has(path))
				ctx.addIssue({ code: "custom", message: "Duplicate attachment path" });
			attachmentPaths.add(path);
		}
	});
export type PortableCheckpoint = z.infer<typeof checkpointSchema>;

export class ContinuityError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
	) {
		super(message);
	}
}
