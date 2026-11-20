import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useEffect, useRef, useState } from "react";
import { LuArrowUpRight, LuCheck, LuLoaderCircle } from "react-icons/lu";
import { AgentInstallDialog } from "renderer/components/AgentSetup/components/AgentInstallDialog/AgentInstallDialog";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export function AccountSignIn({
	provider,
	account,
	onDone,
	onBack,
}: {
	provider: "claude" | "codex";
	account?: { id: string; label: string };
	onDone: (accountId: string) => void;
	onBack: () => void;
}) {
	const [nickname, setNickname] = useState(account?.label ?? "");
	const [status, setStatus] = useState("idle");
	const [error, setError] = useState("");
	const [needsInstall, setNeedsInstall] = useState(false);
	const [canOpenBrowser, setCanOpenBrowser] = useState(false);
	const [acceptsCode, setAcceptsCode] = useState(false);
	const [code, setCode] = useState("");
	const [submittingCode, setSubmittingCode] = useState(false);
	const job = useRef<string | undefined>(undefined);
	const profileId = useRef(account?.id);
	const active = useRef(true);
	const done = useRef(onDone);
	done.current = onDone;
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
			if (job.current)
				void electronTrpcClient.agentAccounts.cancelLogin
					.mutate({ id: job.current })
					.catch(() => {});
		};
	}, []);
	useEffect(() => {
		if (status !== "waiting") return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const state = await electronTrpcClient.agentAccounts.loginStatus.query({
					id: job.current ?? "",
				});
				if (stopped) return;
				setCanOpenBrowser(!!state.authUrl);
				setAcceptsCode(!!state.acceptsCode);
				if (state.browserError) setError(state.browserError);
				if (state.status === "connected") {
					job.current = undefined;
					setStatus("connected");
					setCode("");
					done.current(state.accountId);
					return;
				}
				if (state.status === "error" || state.status === "cancelled") {
					job.current = undefined;
					setError(state.error || "Sign-in cancelled.");
					setStatus("idle");
					return;
				}
			} catch (e) {
				if (!stopped) {
					const id = job.current;
					job.current = undefined;
					if (id)
						await electronTrpcClient.agentAccounts.cancelLogin
							.mutate({ id })
							.catch(() => {});
					if (stopped) return;
					setError(e instanceof Error ? e.message : "Could not check sign-in.");
					setStatus("idle");
				}
				return;
			}
			if (!stopped) timer = setTimeout(poll, 1000);
		};
		void poll();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, [status]);
	const start = async () => {
		setStatus("starting");
		setError("");
		setCode("");
		setCanOpenBrowser(false);
		setAcceptsCode(false);
		try {
			const setup = await electronTrpcClient.system.agentSetupStatus.query();
			if (!active.current) return;
			if (!setup[provider]) {
				setNeedsInstall(true);
				setStatus("idle");
				return;
			}
			const result = await electronTrpcClient.agentAccounts.login.mutate({
				provider,
				nickname: nickname.trim(),
				accountId: profileId.current,
			});
			job.current = result.id;
			profileId.current = result.accountId;
			if (!active.current) {
				await electronTrpcClient.agentAccounts.cancelLogin.mutate({
					id: result.id,
				});
				return;
			}
			setStatus("waiting");
		} catch (e) {
			if (active.current) {
				setError(e instanceof Error ? e.message : "Could not start sign-in.");
				setStatus("idle");
			}
		}
	};
	const busy = status === "waiting" || status === "starting";
	const submitCode = async () => {
		if (!job.current || !code.trim() || submittingCode) return;
		setSubmittingCode(true);
		setError("");
		const value = code.trim();
		setCode("");
		try {
			await electronTrpcClient.agentAccounts.submitLoginCode.mutate({
				id: job.current,
				code: value,
			});
			setAcceptsCode(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not submit the code.");
		} finally {
			setSubmittingCode(false);
		}
	};
	return (
		<form
			className="space-y-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (busy && acceptsCode) void submitCode();
				else if (!busy && status !== "connected" && nickname.trim())
					void start();
			}}
		>
			{needsInstall && (
				<AgentInstallDialog
					agent={provider}
					onClose={() => setNeedsInstall(false)}
					onInstalled={() => {
						setNeedsInstall(false);
						void start();
					}}
				/>
			)}
			<div className="space-y-1.5">
				<label htmlFor="account-nickname" className="text-xs font-medium">
					Account nickname
				</label>
				<Input
					id="account-nickname"
					autoFocus
					maxLength={40}
					placeholder="Personal, Work…"
					value={nickname}
					disabled={busy || status === "connected"}
					onChange={(e) => setNickname(e.target.value)}
				/>
				<p className="text-xs text-muted-foreground">
					Use a name you’ll recognize when switching accounts.
				</p>
			</div>
			{busy && (
				<output className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
					<LuLoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
					<span>
						Finish signing in to{" "}
						{provider === "codex" ? "Codex" : "Claude Code"} in your browser.
						This window will update when it’s connected.
					</span>
				</output>
			)}
			{busy && canOpenBrowser && (
				<Button
					type="button"
					variant="outline"
					onClick={async () => {
						if (!job.current) return;
						try {
							await electronTrpcClient.agentAccounts.reopenLoginBrowser.mutate({
								id: job.current,
							});
							setError("");
						} catch {
							setError(
								"Could not open your browser. Check your default browser, then try again.",
							);
						}
					}}
				>
					<LuArrowUpRight className="size-4" />
					Open sign-in page
				</Button>
			)}
			{busy && acceptsCode && (
				<div className="space-y-2 rounded-lg border border-border p-3">
					<label htmlFor="account-login-code" className="text-sm font-medium">
						Finish with a browser code
					</label>
					<p className="text-xs text-muted-foreground">
						If the browser shows a Copy code button, paste that code here. Keep
						this window open until sign-in is confirmed.
					</p>
					<Input
						id="account-login-code"
						type="password"
						autoComplete="off"
						spellCheck={false}
						value={code}
						onChange={(e) => setCode(e.target.value)}
						placeholder="Paste the current sign-in code"
						maxLength={8_000}
						disabled={submittingCode}
					/>
					<Button
						type="button"
						disabled={!code.trim() || submittingCode}
						onClick={() => void submitCode()}
					>
						{submittingCode ? "Checking…" : "Complete sign-in"}
					</Button>
				</div>
			)}
			{status === "connected" && (
				<output className="flex items-center gap-2 text-sm">
					<LuCheck className="size-4 text-success" />
					{nickname} is connected.
				</output>
			)}
			{error && (
				<p
					role="alert"
					className="select-text cursor-text text-sm text-destructive"
				>
					{error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button variant="ghost" type="button" onClick={onBack}>
					{busy
						? "Cancel sign-in"
						: status === "connected"
							? "Back to accounts"
							: "Back"}
				</Button>
				{!busy && status !== "connected" && (
					<Button type="submit" disabled={!nickname.trim()}>
						<LuArrowUpRight className="size-4" />
						Sign in with browser
					</Button>
				)}
			</div>
		</form>
	);
}
