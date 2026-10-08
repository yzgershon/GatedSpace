import { useEffect, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { SessionNotificationState } from "shared/session-notifications";

export function useNativeSessionStates() {
	const [states, setStates] = useState<SessionNotificationState[]>([]);
	useEffect(() => {
		const subscription =
			electronTrpcClient.notifications.sessionStates.subscribe(undefined, {
				onData: setStates,
			});
		return () => subscription.unsubscribe();
	}, []);
	return states;
}
