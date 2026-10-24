import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SUPERSET_HOME_DIR } from "../app-environment";
import { claudeSessionManager } from "../claude-session/session-manager";
import { codexSessionManager } from "../codex-session/session-manager";
import { listBridgeWorkspaceTargets } from "../mobile-bridge/workspace-targets";
import { sessionEvents } from "../notifications/session-events";
import { ensureSecureDir } from "../secure-file";
import { EnsembleEngine } from "./engine";
import { NativeEnsembleTransport } from "./native-transport";
import { EnsembleFileStorage } from "./storage";

let instance: EnsembleEngine | undefined;
export function ensembleService() {
	if (instance) return instance;
	const directory = join(SUPERSET_HOME_DIR, "ensemble");
	ensureSecureDir(directory);
	const engine = new EnsembleEngine(
		new EnsembleFileStorage(directory),
		new NativeEnsembleTransport(),
	);
	instance = engine;
	const wake = () => queueMicrotask(() => engine.wake());
	sessionEvents.on("change", wake);
	sessionEvents.on("bound", wake);
	engine.on("fault", (error: unknown) =>
		console.error("[ensemble] Coordinator paused by error", error),
	);
	// Backstop for process loss with no final native event. No transcript scans when idle.
	setInterval(() => {
		if (
			engine
				.list()
				.some(
					(g) =>
						g.status === "running" ||
						g.messages.some((m) => m.status === "delivered"),
				)
		)
			engine.wake();
	}, 5_000).unref();
	return engine;
}

export async function createEnsembleSession(
	provider: "codex" | "claude",
	workspaceId: string,
) {
	const target = listBridgeWorkspaceTargets().find((w) => w.id === workspaceId);
	if (!target) throw new Error("Choose an existing GatedSpace workspace.");
	const key = `pane-${randomUUID()}`;
	if (provider === "codex") {
		const state = await codexSessionManager.start({
			key,
			cwd: target.cwd,
			workspaceId,
		});
		if (state.error) throw new Error(state.error);
	} else claudeSessionManager.start(key, { cwd: target.cwd, workspaceId });
	const session = (await ensembleService().transport.list()).find(
		(s) => s.provider === provider && s.key === key,
	);
	if (!session)
		throw new Error(
			"The new conversation is not available yet. Select it from the session list when ready.",
		);
	return session;
}
