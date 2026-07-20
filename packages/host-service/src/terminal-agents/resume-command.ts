import { asc, eq } from "drizzle-orm";
import type { HostDb } from "../db";
import { hostAgentConfigs } from "../db/schema";
import type { TerminalAgentBinding } from "./types";

/**
 * Session ids that may be interpolated into a shell line. Claude Code and
 * Codex both use uuid-style ids; anything else is refused rather than quoted,
 * since the initial command runs through cmd.exe on Windows where quoting
 * rules differ per shell.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

interface AgentLaunchConfig {
	command: string;
	args: string[];
}

/**
 * The user's configured launch row for a built-in agent — the same command
 * the normal agent buttons run (`host_agent_configs`, keyed by presetId).
 * Using it verbatim keeps resume on the identical, known-working launch path
 * (custom launch commands and wrappers included) instead of hardcoding CLIs.
 */
function findAgentLaunchConfig(
	db: HostDb,
	presetId: string,
): AgentLaunchConfig | undefined {
	const row = db
		.select({
			command: hostAgentConfigs.command,
			argsJson: hostAgentConfigs.argsJson,
		})
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.presetId, presetId))
		.orderBy(asc(hostAgentConfigs.displayOrder))
		.limit(1)
		.all()[0];
	if (!row) return undefined;
	let args: string[] = [];
	try {
		const parsed = JSON.parse(row.argsJson);
		if (
			Array.isArray(parsed) &&
			parsed.every((item) => typeof item === "string")
		) {
			args = parsed;
		}
	} catch {
		// malformed args → resume with the bare command
	}
	return { command: row.command, args };
}

export interface BuildAgentResumeCommandOptions {
	/**
	 * Resume as a forked copy: the CLI keeps the full conversation but mints
	 * a NEW session id, so the copy can never contend with the original
	 * session's transcript writer. Claude only (`--fork-session`); Codex has
	 * no fork mode, so a fork request returns null there.
	 */
	fork?: boolean;
}

/**
 * Compose the shell command that reattaches an agent to its on-disk session
 * after the pty died out from under it (machine reboot, daemon crash). Only
 * agents with a known resume CLI are handled; everything else respawns as a
 * plain shell. Returns null when resume isn't possible.
 */
export function buildAgentResumeCommand(
	db: HostDb,
	binding: Pick<TerminalAgentBinding, "agentId" | "agentSessionId">,
	options: BuildAgentResumeCommandOptions = {},
): string | null {
	const sessionId = binding.agentSessionId;
	if (!sessionId || !SAFE_SESSION_ID.test(sessionId)) return null;

	if (binding.agentId === "codex") {
		if (options.fork) return null;
		const config = findAgentLaunchConfig(db, "codex");
		const command = config?.command ?? "codex";
		return `${command} resume ${sessionId}`;
	}

	if (binding.agentId === "claude") {
		const config = findAgentLaunchConfig(db, "claude");
		const command = config?.command ?? "claude";
		const args = config?.args ?? [];
		return [
			command,
			...args,
			"--resume",
			sessionId,
			...(options.fork ? ["--fork-session"] : []),
		].join(" ");
	}

	return null;
}
