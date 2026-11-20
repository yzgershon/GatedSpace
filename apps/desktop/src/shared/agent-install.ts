export type SetupAgent = "codex" | "claude";
export interface AgentInstallState {
	id: string;
	agent: SetupAgent;
	phase: "installing" | "checking" | "ready" | "error" | "cancelled";
	error?: string;
}
