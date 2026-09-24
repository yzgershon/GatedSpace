"use client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";

const client = createAuthClient({ plugins: [deviceAuthorizationClient()] });
export function DeviceConnection() {
	const { data: session, isPending, error: sessionError } = client.useSession();
	const [code, setCode] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [verified, setVerified] = useState(false);
	const [done, setDone] = useState("");
	const [providers, setProviders] = useState<{
		google: boolean;
		github: boolean;
	} | null>(null);
	useEffect(() => {
		setCode(new URLSearchParams(window.location.search).get("user_code") || "");
		const controller = new AbortController();
		fetch("/api/config", { signal: controller.signal })
			.then((response) => response.json())
			.then(setProviders)
			.catch(() => {
				if (!controller.signal.aborted)
					setError("Could not reach the sign-in service. Try refreshing.");
			});
		return () => controller.abort();
	}, []);
	async function signIn(provider: "google" | "github") {
		setBusy(true);
		setError("");
		try {
			const result = await client.signIn.social({
				provider,
				callbackURL: `/device?user_code=${encodeURIComponent(code)}`,
			});
			if (result.error)
				throw new Error(result.error.message || "Sign-in could not start.");
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Sign-in could not start.",
			);
			setBusy(false);
		}
	}
	async function switchAccount() {
		setBusy(true);
		setError("");
		try {
			const result = await client.signOut();
			if (result.error) throw new Error("Could not sign out. Try again.");
			setVerified(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not sign out.");
		} finally {
			setBusy(false);
		}
	}
	async function verify() {
		setBusy(true);
		setError("");
		try {
			const result = await client.device({ query: { user_code: code.trim() } });
			if (result.error)
				throw new Error(
					result.error.error_description || "This code is invalid or expired.",
				);
			// The server accepts only the GatedSpace first-party client ID.
			setVerified(true);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not check the code.",
			);
		} finally {
			setBusy(false);
		}
	}
	async function decide(allow: boolean) {
		setBusy(true);
		setError("");
		try {
			const result = allow
				? await client.device.approve({ userCode: code.trim() })
				: await client.device.deny({ userCode: code.trim() });
			if (result.error)
				throw new Error(
					result.error.error_description || "Could not answer this request.",
				);
			setDone(
				allow
					? "Computer connected. Return to GatedSpace to choose what to sync."
					: "Connection declined. Nothing was shared.",
			);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not answer this request.",
			);
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="connection">
			<a href="/" className="back">
				← Back
			</a>
			<p className="eyebrow">CONNECT YOUR COMPUTER</p>
			<h1>
				A familiar place
				<br />
				on your other PC.
			</h1>
			<div className="connection-card">
				{done ? (
					<output>{done}</output>
				) : isPending ? (
					<output>Checking your account…</output>
				) : !session ? (
					<>
						<h2>Sign in to your private service</h2>
						{sessionError &&
							providers &&
							(providers.github || providers.google) && (
								<p className="error">
									The account service is unavailable. Your local sessions are
									unchanged.
								</p>
							)}
						<p>
							Use the same account on both computers. Your AI-provider sign-ins
							stay on each PC.
						</p>
						<div className="sign-in">
							<button
								type="button"
								disabled={busy || !providers?.github}
								onClick={() => signIn("github")}
							>
								Continue with GitHub
							</button>
							<button
								type="button"
								disabled={busy || !providers?.google}
								onClick={() => signIn("google")}
							>
								Continue with Google
							</button>
						</div>
						{providers && !providers.github && !providers.google && (
							<p className="setup-note">
								Account sign-in is awaiting service setup. No sessions have been
								uploaded.
							</p>
						)}
					</>
				) : (
					<>
						<p className="account">
							Signed in as <strong>{session.user.email}</strong>
						</p>
						<button
							type="button"
							className="back"
							disabled={busy}
							onClick={switchAccount}
						>
							Use another account
						</button>
						<h2>
							{verified
								? "Confirm this is your computer"
								: "Enter the code from GatedSpace"}
						</h2>
						<p>
							{verified
								? "This connects GatedSpace Desktop to your encrypted checkpoints. Confirm the code matches the app on a computer you control. Don’t approve an unexpected code sent by someone else."
								: "Open Sync in GatedSpace on the computer you want to connect."}
						</p>
						<label htmlFor="device-code">Connection code</label>
						<input
							id="device-code"
							autoComplete="off"
							spellCheck={false}
							maxLength={20}
							value={code}
							disabled={busy || verified}
							onChange={(event) => setCode(event.target.value)}
						/>
						{verified ? (
							<div className="actions">
								<button
									type="button"
									className="primary"
									disabled={busy}
									onClick={() => decide(true)}
								>
									Connect this computer
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={() => decide(false)}
								>
									Decline
								</button>
							</div>
						) : (
							<button
								type="button"
								className="primary"
								disabled={busy || !code.trim()}
								onClick={verify}
							>
								Continue
							</button>
						)}
					</>
				)}
				{error && (
					<p className="error" role="alert">
						{error}
					</p>
				)}
			</div>
		</section>
	);
}
