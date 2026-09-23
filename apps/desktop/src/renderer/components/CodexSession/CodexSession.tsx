import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	getCodexSession,
	publishCodexSession,
	subscribeCodexSession,
} from "renderer/lib/codex-session/store";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { CodexTurnReview } from "shared/codex-session/review";
import { CodexComposer } from "./components/CodexComposer/CodexComposer";
import { CodexTranscript } from "./components/CodexTranscript/CodexTranscript";
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
		queryKey: ["native-codex-models"],
		queryFn: () => electronTrpcClient.codexSession.models.query(),
		staleTime: 300_000,
		retry: false,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately reopens the connection after a transport failure.
	useEffect(() => {
		let disposed = false;
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
				model,
				resumeSessionId,
				forkSession,
				workspaceId,
			})
			.then((next) => {
				if (!disposed) {
					publishCodexSession(next);
					setError(null);
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
	return (
		<section className="codex-native" aria-label="Codex conversation">
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
			{(error || state?.error) && (
				<div className="codex-error select-text cursor-text" role="alert">
					<span>{error || state?.error}</span>
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
				onError={setError}
			/>
		</section>
	);
}
