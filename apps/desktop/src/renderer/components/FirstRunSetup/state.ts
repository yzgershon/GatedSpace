import { useStore } from "zustand";
import {
	createJSONStorage,
	persist,
	type StateStorage,
} from "zustand/middleware";
import { createStore } from "zustand/vanilla";

export type SetupStep =
	| "detect"
	| "account"
	| "agents"
	| "workspace"
	| "launch"
	| "complete";
interface FirstRunState {
	step: SetupStep;
	open: boolean;
	agent: "codex" | "claude";
	workspaceId: string | null;
	repoPath: string | null;
	inspect: (hasWork: boolean) => void;
	go: (step: SetupStep) => void;
	chooseAgent: (agent: "codex" | "claude") => void;
	workspaceReady: (id: string, path: string) => void;
	defer: () => void;
	resume: () => void;
	finish: () => void;
}

/** Device-local progress only. Never sync account credentials or setup state between PCs. */
export function createFirstRunStore(storage?: StateStorage) {
	return createStore<FirstRunState>()(
		persist(
			(set, get) => ({
				step: "detect",
				open: false,
				agent: "codex",
				workspaceId: null,
				repoPath: null,
				inspect: (hasWork) => {
					if (get().step === "detect")
						set({ step: hasWork ? "complete" : "account", open: !hasWork });
				},
				go: (step) => set({ step, open: true }),
				chooseAgent: (agent) => set({ agent }),
				workspaceReady: (workspaceId, repoPath) =>
					set({ workspaceId, repoPath, step: "launch", open: true }),
				defer: () => set({ open: false }),
				resume: () =>
					set({
						open: true,
						step: ["detect", "complete"].includes(get().step)
							? "account"
							: get().step,
					}),
				finish: () => set({ step: "complete", open: false }),
			}),
			{
				name: "gatedspace:first-run:v1",
				storage: createJSONStorage(() => storage ?? window.localStorage),
				partialize: ({ step, open, agent, workspaceId, repoPath }) => ({
					step,
					open,
					agent,
					workspaceId,
					repoPath,
				}),
			},
		),
	);
}
export const firstRunStore = createFirstRunStore();
export const useFirstRun = <T>(selector: (state: FirstRunState) => T) =>
	useStore(firstRunStore, selector);
