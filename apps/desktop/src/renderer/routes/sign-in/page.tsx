import { type AuthProvider, COMPANY } from "@superset/shared/constants";
import {
	DEV_EMAIL,
	DEV_NAME,
	DEV_PASSWORD,
} from "@superset/shared/dev-credentials";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { Spinner } from "@superset/ui/spinner";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FaGithub } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { env } from "renderer/env.renderer";
import { track } from "renderer/lib/analytics";
import { setAuthToken } from "renderer/lib/auth-client";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { isLocalMode, isLocalOnlyBuild, setAuthMode } from "renderer/lib/local-mode";
import { SupersetLogo } from "./components/SupersetLogo";
import { useSessionRecovery } from "./hooks/useSessionRecovery";

export const Route = createFileRoute("/sign-in/")({
	component: SignInPage,
});

const LAST_USED_METHOD_KEY = "superset-last-auth-method";

type AuthMethod = AuthProvider | "dev";

const LOCAL_BACKEND_RETRY_INTERVAL_MS = 2_000;
const LOCAL_BACKEND_RETRY_TIMEOUT_MS = 3 * 60 * 1_000;

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function readLastUsedMethod(): AuthMethod | null {
	const stored = window.localStorage.getItem(LAST_USED_METHOD_KEY);
	return stored === "github" || stored === "google" || stored === "dev"
		? stored
		: null;
}

function SignInPage() {
	const signInMutation = electronTrpc.auth.signIn.useMutation();
	const persistToken = electronTrpc.auth.persistToken.useMutation();
	const navigate = useNavigate();
	const [isLoadingDev, setIsLoadingDev] = useState(false);
	const [devError, setDevError] = useState<string | null>(null);
	const [lastUsedMethod, setLastUsedMethod] = useState(readLastUsedMethod);
	const { hasLocalToken, isPending, session } = useSessionRecovery();

	// GatedSpace: the packaged app runs against the local backend, whose
	// OAuth providers are placeholders — the dev account is the real sign-in.
	// Show it whenever the API is local, not only in dev builds.
	const apiIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(
		env.NEXT_PUBLIC_API_URL,
	);
	const showDevSignIn = env.NODE_ENV === "development" || apiIsLocal;

	// Local-only mode has a static session — there's nothing to sign into
	if (isLocalMode()) {
		return <Navigate to="/workspace" replace />;
	}

	// Dev bypass: skip sign-in entirely
	if (env.SKIP_ENV_VALIDATION) {
		return <Navigate to="/workspace" replace />;
	}

	// Show loading while session is being fetched
	if (isPending) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-background">
				<Spinner className="size-8" />
			</div>
		);
	}

	// If already signed in, redirect to workspace
	if (session?.user) {
		return <Navigate to="/workspace" replace />;
	}

	const rememberLastUsedMethod = (method: AuthMethod) => {
		window.localStorage.setItem(LAST_USED_METHOD_KEY, method);
		setLastUsedMethod(method);
	};

	const signIn = (provider: AuthProvider) => {
		track("auth_started", { provider });
		rememberLastUsedMethod(provider);
		signInMutation.mutate({ provider });
	};

	const signInAsDev = async () => {
		setIsLoadingDev(true);
		setDevError(null);
		rememberLastUsedMethod("dev");

		const postAuth = async (path: string, body: Record<string, unknown>) => {
			const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "omit",
				body: JSON.stringify(body),
			});
			const data = (await response.json().catch(() => ({}))) as {
				token?: string;
				code?: string;
				message?: string;
			};
			return { ok: response.ok, status: response.status, data };
		};
		const postAuthWhenLocalBackendIsReady = async (
			path: string,
			body: Record<string, unknown>,
		) => {
			const deadline = Date.now() + LOCAL_BACKEND_RETRY_TIMEOUT_MS;
			let lastError = "Local backend is unavailable";

			do {
				try {
					const result = await postAuth(path, body);
					if (!apiIsLocal || result.ok || result.status < 500) {
						return result;
					}
					lastError = result.data.message ?? `HTTP ${result.status}`;
				} catch (error) {
					if (!apiIsLocal) throw error;
					lastError =
						error instanceof Error ? error.message : "Failed to fetch";
				}

				setDevError("Local services are starting. Retrying automatically...");
				await wait(LOCAL_BACKEND_RETRY_INTERVAL_MS);
			} while (Date.now() < deadline);

			throw new Error(
				`Local GatedSpace services did not become ready within 3 minutes. Last error: ${lastError}`,
			);
		};

		try {
			let result = await postAuthWhenLocalBackendIsReady(
				"/api/auth/sign-in/email",
				{
				email: DEV_EMAIL,
				password: DEV_PASSWORD,
				},
			);
			if (!result.ok && result.data.code === "INVALID_EMAIL_OR_PASSWORD") {
				const signUp = await postAuthWhenLocalBackendIsReady(
					"/api/auth/sign-up/email",
					{
						email: DEV_EMAIL,
						password: DEV_PASSWORD,
						name: DEV_NAME,
					},
				);
				if (!signUp.ok) {
					throw new Error(
						signUp.data.message ?? `Sign-up failed (${signUp.status})`,
					);
				}
				result = await postAuthWhenLocalBackendIsReady(
					"/api/auth/sign-in/email",
					{
						email: DEV_EMAIL,
						password: DEV_PASSWORD,
					},
				);
			}
			if (!result.ok) {
				throw new Error(
					result.data.message ?? `Sign-in failed (${result.status})`,
				);
			}
			const token = result.data.token;
			if (!token) throw new Error("Sign-in did not return a token");
			const expiresAt = new Date(
				Date.now() + 1000 * 60 * 60 * 24 * 30,
			).toISOString();
			await persistToken.mutateAsync({ token, expiresAt });
			setAuthToken(token);
			await navigate({ to: "/workspace", replace: true });
		} catch (error) {
			setDevError(
				error instanceof Error ? error.message : "Dev sign-in failed",
			);
			setIsLoadingDev(false);
		}
	};

	const lastUsedBadge = <Badge variant="secondary">Last used</Badge>;

	return (
		<div className="flex flex-col h-full w-full bg-background">
			<div className="h-12 w-full drag shrink-0" />

			<div className="flex flex-1 items-center justify-center">
				<div className="flex flex-col items-center w-full max-w-md px-8">
					<div className="mb-8">
						<SupersetLogo className="h-24 w-auto" />
					</div>

					<div className="text-center mb-8">
						<h1 className="text-xl font-semibold text-foreground mb-2">
							Welcome to GatedSpace
						</h1>
						<p className="text-sm text-muted-foreground">
							{hasLocalToken
								? "Restoring your session"
								: "Sign in to get started"}
						</p>
					</div>

					<div className="flex flex-col gap-3 w-full max-w-xs">
						{showDevSignIn && (
							<Button
								variant="outline"
								size="lg"
								onClick={signInAsDev}
								className="w-full gap-3"
								disabled={isLoadingDev}
							>
								{isLoadingDev
									? "Signing in..."
									: "Sign in as Local Admin (dev)"}
								{lastUsedMethod === "dev" && lastUsedBadge}
							</Button>
						)}
						{devError && (
							<p className="text-xs text-destructive text-center select-text cursor-text">
								{devError}
							</p>
						)}
						{isLocalOnlyBuild() && (
							<Button
								variant="ghost"
								size="lg"
								onClick={() => {
									setAuthMode("local");
									window.location.reload();
								}}
								className="w-full"
							>
								Use GatedSpace without an account
							</Button>
						)}
						<Button
							variant="outline"
							size="lg"
							onClick={() => signIn("github")}
							className="w-full gap-3"
							disabled={signInMutation.isPending}
						>
							<FaGithub className="size-5" />
							Continue with GitHub
							{lastUsedMethod === "github" && lastUsedBadge}
						</Button>

						<Button
							variant="outline"
							size="lg"
							onClick={() => signIn("google")}
							className="w-full gap-3"
							disabled={signInMutation.isPending}
						>
							<FcGoogle className="size-5" />
							Continue with Google
							{lastUsedMethod === "google" && lastUsedBadge}
						</Button>
					</div>

					<p className="mt-8 text-xs text-muted-foreground/70 text-center max-w-xs">
						By signing in, you agree to our{" "}
						<a
							href={COMPANY.TERMS_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-muted-foreground transition-colors"
						>
							Terms of Service
						</a>{" "}
						and{" "}
						<a
							href={COMPANY.PRIVACY_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-muted-foreground transition-colors"
						>
							Privacy Policy
						</a>
					</p>
				</div>
			</div>
		</div>
	);
}
