import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { record, text } from "shared/codex-session/types";
import {
	addClaudeProfile,
	getClaudeProfile,
	renameClaudeProfile,
} from "../claude-profile";
import { resolveNativeClaude } from "../claude-session/resolve-native";
import { CodexTransport } from "../codex-session/transport";
import { ensureSecureDir, secureExistingFile } from "../secure-file";
import { accountNickname, codexProfiles } from "./codex-profiles";

export type AccountProvider = "claude" | "codex";
export interface AccountLogin {
	id: string;
	provider: AccountProvider;
	accountId: string;
	status: "starting" | "waiting" | "connected" | "error" | "cancelled";
	error?: string;
}

/** Credentials stay in main. Each browser login writes only its own profile. */
export class AgentAccounts {
	private job?: AccountLogin;
	private cancelLogin?: () => void;
	private expiry?: ReturnType<typeof setTimeout>;
	constructor(
		private readonly openBrowser: (url: string) => Promise<unknown>,
		private readonly profiles = codexProfiles,
		private readonly loginTransport = (home: string) =>
			new CodexTransport(undefined, {
				env: {
					CODEX_HOME: home,
					OPENAI_API_KEY: undefined,
					CODEX_API_KEY: undefined,
				},
				config: ['cli_auth_credentials_store="file"'],
			}),
	) {}
	status(id: string) {
		if (this.job?.id !== id) throw new Error("Sign-in has expired. Try again.");
		return { ...this.job };
	}
	async begin(provider: AccountProvider, nickname: string, accountId?: string) {
		if (this.job && ["starting", "waiting"].includes(this.job.status))
			throw new Error("Finish or cancel the current sign-in first.");
		let home: string;
		let id: string;
		if (provider === "codex") {
			const profile = accountId
				? this.profiles.get(accountId)
				: this.profiles.add(nickname);
			home = profile.home;
			id = profile.id;
		} else {
			const profiles = getClaudeProfile().profiles;
			const label = accountNickname(
				nickname,
				profiles.filter((p) => p.id !== accountId).map((p) => p.label),
			);
			const profile = accountId
				? profiles.find((p) => p.id === accountId)
				: addClaudeProfile(label);
			if (!profile) throw new Error("Claude account not found.");
			// Reauthentication must never overwrite a live profile's credentials.
			if (profile.ready)
				throw new Error(
					"This account is already connected. Add a new account to sign in as someone else.",
				);
			home = profile.configDir;
			id = profile.id;
			if (accountId) renameClaudeProfile(accountId, label);
		}
		if (provider === "codex" && existsSync(join(home, "auth.json")))
			throw new Error(
				"This account is already connected. Add a new account for a different login.",
			);
		if (provider === "codex" && accountId)
			this.profiles.rename(accountId, nickname);
		ensureSecureDir(home);
		const job: AccountLogin = {
			id: randomUUID(),
			provider,
			accountId: id,
			status: "starting",
		};
		this.job = job;
		this.expiry = setTimeout(
			() => this.finish(job, "error", "Browser sign-in timed out. Try again."),
			5 * 60_000,
		);
		this.expiry.unref?.();
		void (
			provider === "codex"
				? this.loginCodex(job, home)
				: this.loginClaude(job, home)
		).catch(() =>
			this.finish(
				job,
				"error",
				"Sign-in failed. Check that the CLI is installed and try again.",
			),
		);
		return { ...job };
	}
	cancel(id: string) {
		if (this.job?.id === id) this.finish(this.job, "cancelled");
	}
	private finish(
		job: AccountLogin,
		status: AccountLogin["status"],
		error?: string,
	) {
		if (this.job !== job || !["starting", "waiting"].includes(job.status))
			return;
		job.status = status;
		job.error = error;
		clearTimeout(this.expiry);
		this.cancelLogin?.();
		this.cancelLogin = undefined;
	}
	private async loginCodex(job: AccountLogin, home: string) {
		const transport = this.loginTransport(home);
		let loginId = "";
		this.cancelLogin = () => transport.dispose();
		transport.on("notification", async (message: unknown) => {
			const event = record(message);
			const params = record(event.params);
			if (
				event.method !== "account/login/completed" ||
				(loginId && params.loginId !== loginId) ||
				this.job !== job ||
				job.status !== "waiting"
			)
				return;
			if (!params.success) {
				this.finish(
					job,
					"error",
					"Browser sign-in did not complete. Try again.",
				);
				return;
			}
			try {
				const result = record(
					await transport.request("account/read", { refreshToken: false }),
				);
				if (
					record(result.account).type !== "chatgpt" ||
					!existsSync(join(home, "auth.json"))
				)
					throw new Error("No saved account");
				secureExistingFile(join(home, "auth.json"));
				this.finish(job, "connected");
			} catch {
				this.finish(job, "error", "Could not verify this account. Try again.");
			}
		});
		const result = record(
			await transport.request("account/login/start", { type: "chatgpt" }),
		);
		loginId = text(result.loginId);
		if (!loginId) throw new Error("Missing sign-in identifier");
		if (this.job !== job || job.status !== "starting") {
			transport.dispose();
			return;
		}
		const url = new URL(text(result.authUrl));
		if (
			url.protocol !== "https:" ||
			!["auth.openai.com", "auth0.openai.com", "chatgpt.com"].includes(
				url.hostname,
			)
		)
			throw new Error("Unexpected sign-in URL");
		job.status = "waiting";
		await this.openBrowser(url.href);
	}
	private async loginClaude(job: AccountLogin, home: string) {
		const executable = resolveNativeClaude();
		const env: NodeJS.ProcessEnv = {
			...process.env,
			...executable.env,
			CLAUDE_CONFIG_DIR: home,
		};
		delete env.ANTHROPIC_API_KEY;
		delete env.CLAUDE_CODE_OAUTH_TOKEN;
		const launch = (args: string[]) =>
			spawn(executable.command, [...executable.args, "auth", ...args], {
				env,
				stdio: "pipe",
				windowsHide: true,
				shell: false,
			});
		let child: ChildProcessWithoutNullStreams = launch(["login", "--claudeai"]);
		this.cancelLogin = () => child.kill();
		child.stdout.resume();
		child.stderr.resume();
		job.status = "waiting";
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code) =>
				code === 0 ? resolve() : reject(new Error("Login failed")),
			);
		});
		if (this.job !== job || job.status !== "waiting") return;
		child = launch(["status", "--json"]);
		let output = "";
		child.stdout.on("data", (chunk) => {
			if (output.length < 64_000) output += chunk.toString();
		});
		child.stderr.resume();
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code) =>
				code === 0 ? resolve() : reject(new Error("Not signed in")),
			);
		});
		if (!record(JSON.parse(output)).loggedIn) throw new Error("Not signed in");
		secureExistingFile(join(home, ".credentials.json"));
		this.finish(job, "connected");
	}
}

/** Use the CLI to renew credentials; never invent or store a second OAuth flow. */
const renewals = new Map<
	string,
	Promise<Awaited<ReturnType<typeof readCodexAccountTokens>>>
>();
export function codexAccountTokens(id: string) {
	let pending = renewals.get(id);
	if (!pending) {
		pending = readCodexAccountTokens(id).finally(() => renewals.delete(id));
		renewals.set(id, pending);
	}
	return pending;
}
async function readCodexAccountTokens(id: string) {
	const profile = codexProfiles.get(id);
	const helper = new CodexTransport(undefined, {
		env: {
			CODEX_HOME: profile.home,
			OPENAI_API_KEY: undefined,
			CODEX_API_KEY: undefined,
		},
		config: ['cli_auth_credentials_store="file"'],
	});
	try {
		const result = record(
			await helper.request("account/read", { refreshToken: true }),
		);
		if (!result.account)
			throw new Error("Sign in to this Codex account first.");
		const tokens = record(
			record(JSON.parse(readFileSync(join(profile.home, "auth.json"), "utf8")))
				.tokens,
		);
		const accessToken = text(tokens.access_token);
		const chatgptAccountId = text(tokens.account_id);
		if (!accessToken || !chatgptAccountId)
			throw new Error("This account needs a browser sign-in.");
		secureExistingFile(join(profile.home, "auth.json"));
		return {
			accessToken,
			chatgptAccountId,
			chatgptPlanType: text(record(result.account).planType) || null,
		};
	} finally {
		helper.dispose();
	}
}

export function accountCodexTransport(id: string) {
	// The normal Codex home holds settings, skills, and transcripts. External auth
	// is process-local, so this never overwrites that home's saved credentials.
	const transport = new CodexTransport(undefined, {
		env: { OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined },
		authenticate: async (request) => {
			await request("account/login/start", {
				type: "chatgptAuthTokens",
				...(await codexAccountTokens(id)),
			});
		},
	});
	transport.on("request", async (message: unknown) => {
		const event = record(message);
		if (
			event.method !== "account/chatgptAuthTokens/refresh" ||
			(typeof event.id !== "string" && typeof event.id !== "number")
		)
			return;
		try {
			transport.respond(event.id, await codexAccountTokens(id));
		} catch {
			transport.reject(
				event.id,
				"Add or select a connected account through Swap account.",
			);
		}
	});
	return transport;
}
