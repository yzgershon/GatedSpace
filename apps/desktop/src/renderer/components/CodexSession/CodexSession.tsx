import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AgentSetup } from "renderer/components/AgentSetup/AgentSetup";
import {
	bindCodexDraftSession,
	getCodexDraft,
} from "renderer/lib/codex-session/draft";
import {
	getCodexSession,
	publishCodexSession,
	subscribeCodexSession,
} from "renderer/lib/codex-session/store";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { isCodexModelError } from "shared/codex-session/controls";
import type { CodexTurnReview } from "shared/codex-session/review";
import { CodexAccount } from "./components/CodexAccount/CodexAccount";
import { CodexComposer } from "./components/CodexComposer/CodexComposer";
import { CodexTranscript } from "./components/CodexTranscript/CodexTranscript";
import { CodexUsageRecovery } from "./components/CodexUsageRecovery";
import "./codex-session.css";

export interface CodexSessionProps {
	workspaceId?: string;
	paneId: string;
	cwd: string;
	model?: string;
	resumeSessionId?: string;
	forkSession?: boolean;
	onSessionId: (id: string) => void;
	onReviewChanges?: (review: CodexTurnReview) => void;
}
export function CodexSession(props: CodexSessionProps) {
	const { paneId, cwd, model, resumeSessionId, forkSession, workspaceId } =
		props;
	const state = useSyncExternalStore(
		(listener) => subscribeCodexSession(paneId, listener),
		() => getCodexSession(paneId),
	);
	const callback = useRef(props.onSessionId);
	callback.current = props.onSessionId;
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const [loadingEarlier, setLoadingEarlier] = useState(false);
	const models = useQuery({
		queryKey: ["native-codex-models", paneId, state?.accountId],
		queryFn: () =>
			electronTrpcClient.codexSession.models.query({ key: paneId }),
		staleTime: 300_000,
		retry: false,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately reopens the connection after a transport failure.
	useEffect(() => {
		let disposed = false;
		if (resumeSessionId && !forkSession)
			bindCodexDraftSession(paneId, resumeSessionId);
		const preferences = getCodexDraft(paneId);
		const subscription = electronTrpcClient.codexSession.stream.subscribe(
			{ key: paneId },
			{
				onData: (next) => {
					if (!disposed) publishCodexSession(next);
				},
				onError: (e) => {
					if (!disposed) setError(e.message);
				},
			},
		);
		void electronTrpcClient.codexSession.start
			.mutate({
				key: paneId,
				cwd,
				model: preferences.model || model,
				effort: preferences.effort,
				resumeSessionId,
				forkSession,
				workspaceId,
			})
			.then((next) => {
				if (!disposed) {
					publishCodexSession(next);
					setError(null);
					void models.refetch();
				}
			})
			.catch((e: Error) => {
				if (!disposed) setError(e.message);
			});
		return () => {
			disposed = true;
			subscription.unsubscribe();
		};
	}, [paneId, cwd, model, resumeSessionId, forkSession, workspaceId, retry]);
	useEffect(() => {
		if (state?.threadId) callback.current(state.threadId);
	}, [state?.threadId]);
	// Account recovery publishes a new state in the same pane; clear the old local error too.
	useEffect(() => {
		if (state?.accountId) setError(null);
	}, [state?.accountId]);
	useEffect(() => {
		if (state?.usageLimit || state?.status === "working") setError(null);
	}, [state?.usageLimit, state?.status]);
	return (
		<section className="codex-native" aria-label="Codex conversation">
			<CodexAccount paneId={paneId} compact />
			<CodexTranscript
				state={state}
				loadingEarlier={loadingEarlier}
				onReviewChanges={props.onReviewChanges}
				onEarlier={async () => {
					setLoadingEarlier(true);
					try {
						publishCodexSession(
							await electronTrpcClient.codexSession.earlier.mutate({
								key: paneId,
							}),
						);
					} catch (e) {
						setError(e instanceof Error ? e.message : String(e));
					} finally {
						setLoadingEarlier(false);
					}
				}}
				onSuggest={(value) =>
					window.dispatchEvent(
						new CustomEvent(`codex-draft:${paneId}`, { detail: value }),
					)
				}
			/>
			{state?.usageLimit && <CodexUsageRecovery state={state} />}
			{!state?.usageLimit && (error || state?.error) && (
				<div className="codex-error select-text cursor-text" role="alert">
					{isCodexModelError(error || state?.error) ? (
						<div className="min-w-0">
							<p>
								Codex rejected this model. Update Codex, then reopen GatedSpace,
								or choose an available model from Model and effort. Your
								conversation is preserved.
							</p>
							<details className="mt-2 text-muted-foreground break-words">
								<summary className="cursor-pointer">Error details</summary>
								{error || state?.error}
							</details>
						</div>
					) : (
						<>
							<span>{error || state?.error}</span>
							<AgentSetup
								agent="codex"
								compact
								onReady={() => {
									setError(null);
									setRetry((n) => n + 1);
								}}
							/>
						</>
					)}
					{state?.status === "error" && (
						<button
							type="button"
							onClick={() => {
								setError(null);
								setRetry((n) => n + 1);
							}}
						>
							Reconnect
						</button>
					)}
				</div>
			)}
			<CodexComposer
				key={paneId}
				paneId={paneId}
				state={state}
				models={models.data ?? []}
				modelsLoading={models.isFetching}
				modelsError={models.error?.message}
				onRefreshModels={() => {
					void models.refetch();
				}}
				onError={setError}
			/>
		</section>
	);
}
