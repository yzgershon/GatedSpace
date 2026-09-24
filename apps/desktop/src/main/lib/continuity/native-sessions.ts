import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PortableCheckpoint } from "@superset/shared/continuity";
import { record, text } from "../../../shared/codex-session/types";
import { getClaudeProfile } from "../claude-profile";
import { claudeSessionManager } from "../claude-session/session-manager";
import {
	applyTitleOverrides,
	listClaudeSessions,
	setSessionTitleOverride,
} from "../claude-sessions";
import { codexSessionManager } from "../codex-session/session-manager";
import { findCodexRolloutPath, listCodexSessions } from "../codex-sessions";
import {
	ensureSecureDir,
	secureExistingFile,
} from "../secure-file/secure-file";
import { packAttachments, unpackAttachments } from "./attachments";
import { exportCodexRollout, retargetCodexRollout } from "./codex-rollout";

export function transferableSessions() {
	return (["codex", "claude"] as const)
		.flatMap((provider) =>
			applyTitleOverrides(
				provider === "codex" ? listCodexSessions(300) : listClaudeSessions(300),
			).map((item) => ({ ...item, provider })),
		)
		.sort((a, b) => b.lastModified - a.lastModified);
}
export function isNativeSessionBusy(provider: "codex" | "claude", id: string) {
	if (provider === "codex")
		return codexSessionManager
			.listSessions()
			.some(
				(session) =>
					session.threadId === id &&
					(session.status === "working" || session.status === "loading"),
			);
	return claudeSessionManager
		.listSessions()
		.some(
			(session) =>
				session.sessionId === id && claudeSessionManager.isBusy(session.key),
		);
}
export function assertIdle(provider: "codex" | "claude", id: string) {
	if (isNativeSessionBusy(provider, id))
		throw new Error(
			"Wait for the current task to finish before saving this checkpoint.",
		);
}
export async function exportNativeSession(
	provider: "codex" | "claude",
	id: string,
) {
	assertIdle(provider, id);
	const item = transferableSessions().find(
		(row) => row.provider === provider && row.sessionId === id,
	);
	if (!item?.cwd)
		throw new Error("Select a saved session with an available project folder.");
	const before = await stat(item.filePath);
	if (before.size > 128 * 1024 * 1024)
		throw new Error("This conversation exceeds the transfer size limit.");
	const transcript =
		provider === "codex"
			? await exportCodexRollout(item.filePath, findCodexRolloutPath)
			: await readFile(item.filePath, "utf8");
	const after = await stat(item.filePath);
	assertIdle(provider, id);
	if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
		throw new Error(
			"The conversation changed during export. Wait for it to finish and retry.",
		);
	for (const line of transcript.trimEnd().split("\n")) JSON.parse(line);
	const packed = await packAttachments(transcript);
	return {
		session: {
			provider,
			title: item.title,
			originalId: id,
			originalCwd: item.cwd,
			format: provider === "codex" ? "codex-rollout-v1" : "claude-jsonl-v1",
			...packed,
		} satisfies PortableCheckpoint["session"],
		sourceStamp: `${after.mtimeMs}:${after.size}`,
		verify: async () => {
			assertIdle(provider, id);
			const current = await stat(item.filePath);
			if (current.mtimeMs !== after.mtimeMs || current.size !== after.size)
				throw new Error(
					"The conversation changed while collecting project files. Wait for it to finish and retry.",
				);
		},
	};
}

export async function importNativeSession(
	session: PortableCheckpoint["session"],
	cwd: string,
) {
	const id: string = randomUUID();
	const transcript = await unpackAttachments(
		session,
		join(cwd, ".gatedspace-sync", "attachments", id),
	);
	if (session.provider === "codex") {
		const now = new Date().toISOString();
		const directory = join(
			process.env.CODEX_HOME || join(homedir(), ".codex"),
			"sessions",
			now.slice(0, 4),
			now.slice(5, 7),
			now.slice(8, 10),
		);
		ensureSecureDir(directory);
		const path = join(
			directory,
			`rollout-${now.slice(0, 19).replaceAll(":", "-")}-${id}.jsonl`,
		);
		await writeFile(path, retargetCodexRollout(transcript, id, cwd), {
			flag: "wx",
			mode: 0o600,
		});
		secureExistingFile(path);
		const result = record(
			await codexSessionManager.transport.request("thread/resume", {
				threadId: id,
				path,
				cwd,
				runtimeWorkspaceRoots: [cwd],
				approvalPolicy: "on-request",
				sandbox: "workspace-write",
				excludeTurns: true,
			}),
		);
		if (text(record(result.thread).id) !== id)
			throw new Error(
				"Codex could not verify the imported conversation. The restored files remain available.",
			);
		await codexSessionManager.rename(id, session.title);
		await codexSessionManager.transport.request("thread/unsubscribe", {
			threadId: id,
		});
	} else {
		const profile = getClaudeProfile();
		const config = profile.profiles.find(
			(row) => row.id === profile.activeProfileId,
		)?.configDir;
		if (!config)
			throw new Error("Set up your Claude account on this computer first.");
		// Current Claude supports cross-directory ID lookup. A dedicated import
		// bucket avoids ambiguous same-ID copies under different encoded paths.
		const directory = join(config, "projects", "gatedspace-sync");
		ensureSecureDir(directory);
		const lines = transcript
			.trimEnd()
			.split("\n")
			.map((line) => {
				const row = record(JSON.parse(line));
				if (row.sessionId) row.sessionId = id;
				if (row.cwd) row.cwd = cwd;
				return JSON.stringify(row);
			});
		const path = join(directory, `${id}.jsonl`);
		await writeFile(path, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
		secureExistingFile(path);
	}
	setSessionTitleOverride(id, session.title);
	return {
		sessionId: id,
		provider: session.provider,
		cwd,
		title: session.title,
	};
}
