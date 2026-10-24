import { z } from "zod";

export const ensembleProvider = z.enum(["codex", "claude"]);
export const ensembleContext = z.object({
	name: z.string().min(1).max(120),
	text: z.string().min(1).max(12000),
});
export const ensembleAgreements = [
	{
		id: "review",
		title: "Independent review",
		description: "Challenge the deliverable before calling it done.",
	},
	{
		id: "evidence",
		title: "Evidence first",
		description: "Separate verified findings, assumptions, and open questions.",
	},
	{
		id: "small-changes",
		title: "Small changes",
		description: "Keep edits focused and verify each meaningful change.",
	},
	{
		id: "accessibility",
		title: "Accessible by default",
		description: "Check keyboard use, contrast, and reduced motion in UI work.",
	},
] as const;
export const ensembleAgreementId = z.enum([
	"review",
	"evidence",
	"small-changes",
	"accessibility",
]);
export const memberInput = z.object({
	provider: ensembleProvider,
	key: z.string().min(1).max(200),
	conversationId: z.string().min(1).max(200).nullable(),
	title: z.string().min(1).max(100),
	role: z.string().min(1).max(240),
	cwd: z.string().min(1).max(2000),
	workspaceId: z.string().optional(),
});
export const createEnsembleInput = z.object({
	title: z.string().trim().min(1).max(100),
	goal: z.string().trim().min(5).max(8000),
	criteria: z.string().trim().min(5).max(4000),
	members: z.array(memberInput).min(2).max(6),
	commanderIndex: z.number().int().min(0).max(5),
	maxMessages: z.number().int().min(4).max(100).default(24),
	concurrency: z.number().int().min(1).max(3).default(2),
	context: z.array(ensembleContext).max(4).default([]),
	agreements: z.array(ensembleAgreementId).max(4).default([]),
});
export type EnsembleMember = z.infer<typeof memberInput> & {
	id: string;
	removed?: boolean;
};
export type MemberStatus =
	| "idle"
	| "working"
	| "attention"
	| "offline"
	| "error";
export type EnsembleStatus =
	| "draft"
	| "running"
	| "paused"
	| "stopped"
	| "completed";
export type DeliveryStatus =
	| "queued"
	| "sending"
	| "delivered"
	| "answered"
	| "uncertain"
	| "cancelled";
export interface EnsembleMessage {
	id: string;
	from: string;
	to: string;
	kind: "brief" | "message" | "assignment" | "review";
	text: string;
	status: DeliveryStatus;
	createdAt: number;
	deliveredAt?: number;
	answeredAt?: number;
	reply?: string;
	error?: string;
	actionsApplied?: boolean;
	replyTo?: string;
}
export interface EnsembleTask {
	id: string;
	title: string;
	owner: string;
	status: "todo" | "doing" | "review" | "done";
	dependsOn: string[];
}
export interface EnsembleArtifact {
	id: string;
	title: string;
	versions: { body: string; author: string; at: number; messageId: string }[];
	reviews: {
		author: string;
		text: string;
		version: number;
		at: number;
		messageId: string;
	}[];
}
export interface EnsembleEvent {
	id: string;
	at: number;
	kind:
		| "created"
		| "state"
		| "delivery"
		| "reply"
		| "task"
		| "artifact"
		| "decision"
		| "issue"
		| "member";
	text: string;
	memberId?: string;
	messageId?: string;
}
export interface EnsembleGroup {
	id: string;
	title: string;
	goal: string;
	criteria: string;
	status: EnsembleStatus;
	commanderId: string;
	members: EnsembleMember[];
	messages: EnsembleMessage[];
	tasks: EnsembleTask[];
	artifacts: EnsembleArtifact[];
	decisions: { text: string; author: string; at: number }[];
	events: EnsembleEvent[];
	maxMessages: number;
	concurrency: number;
	context?: z.infer<typeof ensembleContext>[];
	agreements?: z.infer<typeof ensembleAgreementId>[];
	createdAt: number;
	updatedAt: number;
	result?: { text: string; artifactId: string; at: number };
	issue?: string;
}
const identifier = z.string().min(1).max(100);
export const ensembleAction = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("send"),
		to: identifier,
		text: z.string().min(1).max(8000),
		kind: z.enum(["message", "assignment", "review"]).default("message"),
	}),
	z.object({
		type: z.literal("task"),
		id: identifier,
		title: z.string().min(1).max(200),
		owner: identifier,
		status: z.enum(["todo", "doing", "review", "done"]),
		dependsOn: z.array(identifier).max(12).default([]),
	}),
	z.object({
		type: z.literal("artifact"),
		id: identifier,
		title: z.string().min(1).max(200),
		body: z.string().min(1).max(30000),
	}),
	z.object({
		type: z.literal("review"),
		artifactId: identifier,
		version: z.number().int().positive(),
		text: z.string().min(1).max(8000),
	}),
	z.object({ type: z.literal("decision"), text: z.string().min(1).max(4000) }),
	z.object({
		type: z.literal("complete"),
		artifactId: identifier,
		text: z.string().min(1).max(4000),
	}),
]);
export type EnsembleAction = z.infer<typeof ensembleAction>;
export const ensembleReply = z.object({
	summary: z.string().max(12000),
	actions: z.array(ensembleAction).max(8),
});
export interface EnsembleSnapshot {
	groups: EnsembleGroup[];
	sessions: EnsembleSession[];
}
export interface EnsembleSession extends z.infer<typeof memberInput> {
	status: MemberStatus;
}
export interface EnsembleObservation {
	status: MemberStatus;
	conversationId: string | null;
	response?: { text: string; successful: boolean };
	intervened?: boolean;
	error?: string;
}
