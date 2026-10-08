import { useEffect, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { QueuedPrompt, SessionQueueState } from "shared/session-queue";

export function useMessageQueue(key?: string) {
	const [state, setState] = useState<SessionQueueState>({
		entries: [],
		paused: false,
	});
	const [error, setError] = useState<string>();
	useEffect(() => {
		setState({ entries: [], paused: false });
		setError(undefined);
		if (!key) return;
		let active = true;
		const subscription = electronTrpcClient.sessionQueue.stream.subscribe(
			{ key },
			{
				onData: (state) => {
					if (active) setState(state);
				},
				onError: (error) => {
					if (active) setError(error.message);
				},
			},
		);
		return () => {
			active = false;
			subscription.unsubscribe();
		};
	}, [key]);
	const api = electronTrpcClient.sessionQueue;
	return {
		state,
		error,
		setError,
		enqueue: (prompt: QueuedPrompt) =>
			api.enqueue.mutate({ key: key ?? "", prompt }),
		pause: () => api.pause.mutate({ key: key ?? "" }),
		resume: (expectedPauseVersion?: number) =>
			api.resume.mutate({ key: key ?? "", expectedPauseVersion }),
		edit: (id: string, text: string) =>
			api.edit.mutate({ key: key ?? "", id, text }),
		beginEdit: (id: string) => api.beginEdit.mutate({ key: key ?? "", id }),
		replace: (id: string, prompt: QueuedPrompt) =>
			api.replace.mutate({ key: key ?? "", id, prompt }),
		remove: (id: string) => api.remove.mutate({ key: key ?? "", id }),
		steer: (id: string) => api.steer.mutate({ key: key ?? "", id }),
	};
}
