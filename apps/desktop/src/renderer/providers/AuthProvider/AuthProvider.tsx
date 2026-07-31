import { type ReactNode, useEffect, useState } from "react";
import {
	BootScreen,
	MIN_SPLASH_MS,
} from "renderer/components/BootScreen/BootScreen";
import { getStoredTokenOutcome } from "renderer/lib/auth-bootstrap";
import { authClient, setAuthToken, setJwt } from "renderer/lib/auth-client";
import { isLocalMode } from "renderer/lib/local-mode";
import { markStartupOnce } from "renderer/lib/startup-mark";
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

/**
 * Local mode has a static session and nothing to hydrate, but still shows the
 * launch splash for its minimum duration so every build opens the same way.
 *
 * The splash is an OVERLAY over a mounted app, not a gate in front of an
 * unmounted one. That distinction was most of the launch time: `.boot-screen`
 * is already `position: fixed; inset: 0`, but returning it *instead* of
 * children meant nothing below it existed yet — so the host service wasn't
 * even asked to start until the animation finished, and the workspace list,
 * sidebar and session transcript queued up behind that. Every one of those now
 * runs while the animation plays, and by the time the splash lifts the app is
 * usually already there.
 *
 * Layout is unaffected because the overlay is fixed-position: panes underneath
 * measure their real size, so terminals and editors size correctly even though
 * they are covered.
 *
 * Cloud mode now does the same, since the stored token is applied before React
 * renders (see lib/auth-bootstrap) — so the condition its gate existed to
 * protect is already satisfied by the time anything mounts.
 */
function LocalBootGate({ children }: { children: ReactNode }) {
	const splashDone = useMinSplashElapsed();
	return (
		<>
			{children}
			{splashDone ? null : <BootScreen />}
		</>
	);
}

function CloudAuthProvider({ children }: { children: ReactNode }) {
	/*
	 * Already hydrated, unless the pre-render token step could not run.
	 *
	 * `index.tsx` applies the stored token before React renders, so by the time
	 * this mounts the only thing hydration ever gated on — a token being in place
	 * before the authenticated tree appears — has already happened. Waiting again
	 * cost a full network round-trip (4.7s measured) for a condition that was
	 * already true.
	 *
	 * `unavailable` means that step could not get an answer, so the token state is
	 * genuinely unknown and the old awaited path below still runs. An unknown
	 * answer must not be read as "no token": that would send a signed-in user to
	 * the login screen.
	 */
	const [isHydrated, setIsHydrated] = useState(
		() => getStoredTokenOutcome() !== "unavailable",
	);
	const splashDone = useMinSplashElapsed();
	const { refetch: refetchSession } = authClient.useSession();

	const { data: storedToken, isSuccess } =
		electronTrpc.auth.getStoredToken.useQuery(undefined, {
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		});

	/*
	 * FALLBACK PATH ONLY.
	 *
	 * Normally `isHydrated` starts true, because the token was applied before
	 * render, and this effect no-ops. It runs only when the pre-render step could
	 * not get an answer, in which case the token's state is unknown and the old
	 * slow-but-certain sequence is the right thing to do.
	 */
	useEffect(() => {
		if (!isSuccess || isHydrated) return;

		let cancelled = false;

		async function hydrate() {
			if (storedToken?.token && storedToken?.expiresAt) {
				const isExpired = new Date(storedToken.expiresAt) < new Date();
				if (!isExpired) {
					// Synchronous and local, and it must happen before either request
					// below so both go out authenticated.
					setAuthToken(storedToken.token);

					/*
					 * The JWT fetch is STARTED here but not awaited.
					 *
					 * These were two sequential network round-trips in front of the
					 * whole app, and only one of them gates anything: the authenticated
					 * layout needs `session.user` before it will render, and nothing at
					 * mount needs the JWT. Awaiting it charged a full round-trip of
					 * launch time for a value that arrives in time regardless.
					 *
					 * The session refetch below IS awaited on this path, deliberately.
					 * Reaching here means the token was applied late, so the session
					 * store's first attempt already went out unauthenticated; the layout
					 * would read `!isSignedIn` and redirect to sign-in. Mounting before
					 * the authenticated refetch lands would race that redirect and could
					 * bounce a signed-in user to the login screen. The fast path avoids
					 * this by applying the token before that first request happens at all.
					 */
					const jwtRequest = authClient
						.token()
						.then((res) => {
							if (res.data?.token) setJwt(res.data.token);
						})
						.catch((err: unknown) => {
							console.warn("[AuthProvider] JWT fetch failed", err);
						});
					// Referenced so the promise is not treated as accidentally floating.
					void jwtRequest;

					try {
						await refetchSession();
					} catch (err) {
						console.warn(
							"[AuthProvider] session refetch failed during hydration",
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

	useEffect(() => {
		markStartupOnce("auth provider mounted");
	}, []);
	useEffect(() => {
		if (isHydrated) markStartupOnce("auth hydrated");
	}, [isHydrated]);

	// Hydration is a real gate: mounting the authenticated tree before a token
	// exists fires unauthenticated queries. The splash floor is NOT — it is
	// cosmetic, and making the app wait on it after hydration means the animation
	// is charged to launch time twice. Overlay it instead, the same way local mode
	// does, so anything still to come happens underneath it.
	if (!isHydrated) {
		return <BootScreen />;
	}

	return (
		<>
			{children}
			{splashDone ? null : <BootScreen />}
		</>
	);
}
