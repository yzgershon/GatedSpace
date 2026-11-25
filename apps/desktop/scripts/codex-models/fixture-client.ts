import { electronTrpcClient as base } from "../codex-session/fixture-client";

const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"];
let current = !location.search.includes("missing");
let fail = false;
let queries = 0;
const starts: unknown[] = [];
Object.assign(window, {
	codexModelsFixture: {
		starts,
		queries: () => queries,
		update: () => {
			current = true;
		},
		fail: () => {
			fail = true;
		},
		recover: () => {
			fail = false;
		},
	},
});

export const electronTrpcClient = {
	...base,
	codexSession: {
		...base.codexSession,
		models: {
			query: async () => {
				queries++;
				if (fail) throw new Error("Catalog unavailable");
				return [
					"gpt-6-astra",
					...(current ? ["gpt-6.2-astra", "gpt-6.2-sol"] : []),
				].map((id) => ({
					id,
					name: id,
					efforts,
					defaultEffort: "low",
				}));
			},
		},
		start: {
			mutate: async (input: {
				key: string;
				model?: string;
				effort?: string;
			}) => {
				starts.push(input);
				return {
					...(await base.codexSession.start.mutate(input)),
					model: input.model || "gpt-6.2-astra",
					effort: input.effort || "xhigh",
					error: current
						? null
						: `Error running remote compact task: {"code":"model_not_found","message":"The 'gpt-6.2-astra' model is not supported when using Codex with a ChatGPT account."}`,
				};
			},
		},
	},
};
