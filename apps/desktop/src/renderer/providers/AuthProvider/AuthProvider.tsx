import { type ReactNode, useEffect, useState } from "react";
import {
	BootScreen,
	MIN_SPLASH_MS,
} from "renderer/components/BootScreen/BootScreen";
import { authClient, setAuthToken, setJwt } from "renderer/lib/auth-client";
import { isLocalMode } from "renderer/lib/local-mode";
import { electronTrpc } from "../../lib/electron-trpc";

/**
 * Keep the boot splash on screen for at least MIN_SPLASH_MS so its animation
 * plays in full. Hydration (cloud) or the static local session usually
 * resolves in a few hundred ms, which would otherwise cut the splash short.
 */
function useMinSplashElapsed(): boolean {
	const [elapsed, setElapsed] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setElapsed(true), MIN_SPLASH_MS);
		return () => clearTimeout(timer);
	}, []);
	return elapsed;
}

export function AuthProvider({ children }: { children: ReactNode }) {
	if (isLocalMode()) {
		return <LocalBootGate>{children}</LocalBootGate>;
	}
	return <CloudAuthProvider>{children}</CloudAuthProvider>;
}

// Local mode has a static session and nothing to hydrate, but still shows the
// launch splash for its minimum duration so every build opens the same way.
function LocalBootGate({ children }: { children: ReactNode }) {
	const splashDone = useMinSplashElapsed();
	if (!splashDone) return <BootScreen />;
	return <>{children}</>;
}

function CloudAuthProvider({ children }: { children: ReactNode }) {
	const [isHydrated, setIsHydrated] = useState(false);
	const splashDone = useMinSplashElapsed();
	const { refetch: refetchSession } = authClient.useSession();

	const { data: storedToken, isSuccess } =
		electronTrpc.auth.getStoredToken.useQuery(undefined, {
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		});

	useEffect(() => {
		if (!isSuccess || isHydrated) return;

		let cancelled = false;

		async function hydrate() {
			if (storedToken?.token && storedToken?.expiresAt) {
				const isExpired = new Date(storedToken.expiresAt) < new Date();
				if (!isExpired) {
					setAuthToken(storedToken.token);
					try {
						await refetchSession();
					} catch (err) {
						console.warn(
							"[AuthProvider] session refetch failed during hydration",
							err,
						);
					}
					try {
						const res = await authClient.token();
						if (res.data?.token) {
							setJwt(res.data.token);
						}
					} catch (err) {
						console.warn(
							"[AuthProvider] JWT fetch failed during hydration",
							err,
						);
					}
				}
			}
			if (!cancelled) {
				setIsHydrated(true);
			}
		}

		hydrate();
		return () => {
			cancelled = true;
		};
	}, [storedToken, isSuccess, isHydrated, refetchSession]);

	electronTrpc.auth.onTokenChanged.useSubscription(undefined, {
		onData: async (data) => {
			if (data?.token && data?.expiresAt) {
				setAuthToken(null);
				await authClient.signOut({ fetchOptions: { throw: false } });
				setAuthToken(data.token);
				try {
					await refetchSession();
				} catch (err) {
					console.warn(
						"[AuthProvider] session refetch failed after token change",
						err,
					);
				}
				setIsHydrated(true);
			} else if (data === null) {
				setAuthToken(null);
				setJwt(null);
				try {
					await refetchSession();
				} catch (err) {
					console.warn(
						"[AuthProvider] session refetch failed after token cleared",
						err,
					);
				}
			}
		},
	});

	useEffect(() => {
		if (!isHydrated) return;

		const refreshJwt = () =>
			authClient
				.token()
				.then((res) => {
					if (res.data?.token) {
						setJwt(res.data.token);
					}
				})
				.catch((err: unknown) => {
					console.warn("[AuthProvider] JWT refresh failed", err);
				});

		refreshJwt();
		const interval = setInterval(refreshJwt, 50 * 60 * 1000);
		return () => clearInterval(interval);
	}, [isHydrated]);

	if (!isHydrated || !splashDone) {
		return <BootScreen />;
	}

	return <>{children}</>;
}
