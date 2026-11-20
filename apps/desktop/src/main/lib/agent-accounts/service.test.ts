import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexTransport } from "../codex-session/transport";
import { CodexProfiles } from "./codex-profiles";
import { AgentAccounts } from "./service";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanups.splice(0)) fn();
});
class LoginTransport extends CodexTransport {
	disposed = false;
	verified = true;
	url = "https://auth.openai.com/authorize?test=true";
	home = "";
	async request(method: string) {
		if (method === "account/login/start")
			return { loginId: "login-1", authUrl: this.url };
		if (this.verified) writeFileSync(join(this.home, "auth.json"), "{}");
		return {
			account: this.verified
				? { type: "chatgpt", email: "test@example.invalid" }
				: null,
		};
	}
	dispose() {
		this.disposed = true;
	}
}
function fixture(openBrowser?: (url: string) => Promise<void>) {
	const root = mkdtempSync(join(tmpdir(), "gs-login-test-"));
	const profiles = new CodexProfiles(root, join(root, "original"));
	const transport = new LoginTransport();
	const opened: string[] = [];
	const service = new AgentAccounts(
		async (url) => {
			opened.push(url);
			await openBrowser?.(url);
		},
		profiles,
		(home) => {
			transport.home = home;
			return transport;
		},
	);
	cleanups.push(() => {
		transport.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	return { service, transport, profiles, opened };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test("a failed browser launch keeps the same sign-in alive for reopening", async () => {
	let fail = true;
	const { service, transport, opened } = fixture(async () => {
		if (fail) throw new Error("No browser handler");
	});
	const job = await service.begin("codex", "Work");
	await tick();
	expect(service.status(job.id).status).toBe("waiting");
	expect(service.status(job.id).browserError).toContain("Open sign-in page");
	expect(transport.disposed).toBe(false);
	fail = false;
	await service.reopenBrowser(job.id);
	expect(opened).toHaveLength(2);
	expect(opened[0]).toBe(opened[1]);
	expect(service.status(job.id).browserError).toBeUndefined();
	service.cancel(job.id);
	expect(service.status(job.id).authUrl).toBeUndefined();
	await expect(service.reopenBrowser(job.id)).rejects.toThrow("new sign-in");
	expect(() => service.submitCode(job.id, "unused")).toThrow("ended");
});
test("browser completion is verified before marking an account connected", async () => {
	const { service, transport, profiles, opened } = fixture();
	const job = await service.begin("codex", "Work");
	await tick();
	expect(service.status(job.id).status).toBe("waiting");
	expect(opened).toHaveLength(1);
	transport.emit("notification", {
		method: "account/login/completed",
		params: { loginId: "wrong", success: true },
	});
	await tick();
	expect(service.status(job.id).status).toBe("waiting");
	transport.emit("notification", {
		method: "account/login/completed",
		params: { loginId: "login-1", success: true },
	});
	await tick();
	expect(service.status(job.id).status).toBe("connected");
	expect(transport.disposed).toBe(true);
	expect(profiles.resolve()).toBe("default");
	expect(JSON.stringify(service.status(job.id))).not.toContain("token");
});
test("cancelling sign-in ignores a late callback and releases the helper", async () => {
	const { service, transport } = fixture();
	const job = await service.begin("codex", "Personal");
	await tick();
	await expect(service.begin("codex", "Other")).rejects.toThrow(
		"Finish or cancel",
	);
	service.cancel(job.id);
	transport.emit("notification", {
		method: "account/login/completed",
		params: { loginId: "login-1", success: true },
	});
	await tick();
	expect(service.status(job.id).status).toBe("cancelled");
	expect(transport.disposed).toBe(true);
});
test("failed verification and unexpected login URLs never count as connected", async () => {
	const { service, transport, opened } = fixture();
	transport.url = "https://example.invalid/login";
	const job = await service.begin("codex", "Untrusted");
	await tick();
	expect(opened).toHaveLength(0);
	expect(service.status(job.id).status).toBe("error");
	transport.url = "https://auth.openai.com/authorize";
	transport.verified = false;
	const retry = await service.begin("codex", "Untrusted", job.accountId);
	await tick();
	transport.emit("notification", {
		method: "account/login/completed",
		params: { loginId: "login-1", success: true },
	});
	await tick();
	expect(service.status(retry.id).status).toBe("error");
});
