import type { z } from "zod";
import type {
	createEnsembleInput,
	EnsembleMember,
	EnsembleSession,
	EnsembleSnapshot,
} from "../../../shared/ensemble";

export interface EnsembleActions {
	create(input: z.input<typeof createEnsembleInput>): Promise<string>;
	control(
		id: string,
		action: "start" | "pause" | "resume" | "stop",
	): Promise<void>;
	message(id: string, to: string, text: string): Promise<void>;
	update(
		id: string,
		input: { goal: string; criteria: string; maxMessages: number },
	): Promise<void>;
	resolve(id: string, messageId: string, retry: boolean): Promise<void>;
	addMember(id: string, member: EnsembleMember): Promise<void>;
	removeMember(id: string, memberId: string): Promise<void>;
	createSession(
		provider: "codex" | "claude",
		workspaceId: string,
	): Promise<EnsembleSession>;
	openSession(member: EnsembleMember): void;
}
export interface EnsembleProps {
	snapshot: EnsembleSnapshot;
	actions: EnsembleActions;
	workspaces: { id: string; name: string; project: string }[];
	evidenceLabel?: string;
}
