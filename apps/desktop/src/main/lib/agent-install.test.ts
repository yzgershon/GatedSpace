import { expect, test } from "bun:test";
import { AgentInstaller, agentInstallScript } from "./agent-install";

const result = (codex: boolean) => ({
	codex,
	claude: false,
	accounts: {
		codex: { signedIn: false, nickname: null },
		claude: { signedIn: false, nickname: null },
	},
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test("installation is shared, verified, and separate from authentication", async () => {
	let installed = false;
	let calls = 0;
	const installer = new AgentInstaller(
		async () => result(installed),
		async (_cmd, args) => {
			calls++;
			const script = Buffer.from(args.at(-1) ?? "", "base64").toString(
				"utf16le",
			);
			expect(script).toContain("CODEX_NON_INTERACTIVE");
			expect(script).not.toContain("auth login");
			expect(script).not.toContain("codex login");
			installed = true;
			return { stdout: "", stderr: "" };
		},
		"win32",
	);
	const first = installer.start("codex");
	expect(installer.start("codex").id).toBe(first.id);
	await tick();
	expect(installer.get("codex")?.phase).toBe("ready");
	expect(calls).toBe(1);
	installer.start("codex");
	await tick();
	expect(calls).toBe(1);
});
test("successful installer exit without a working CLI is not ready; retry can recover", async () => {
	let installed = false;
	const installer = new AgentInstaller(
		async () => result(installed),
		async () => ({ stdout: "", stderr: "" }),
		"win32",
	);
	installer.start("codex");
	await tick();
	expect(installer.get("codex")?.phase).toBe("error");
	installed = true;
	installer.start("codex");
	await tick();
	expect(installer.get("codex")?.phase).toBe("ready");
});
test("cancel waits for helper shutdown and cannot later publish ready", async () => {
	let aborted = false;
	const installer = new AgentInstaller(
		async () => result(false),
		async (_cmd, _args, { signal }) => {
			await new Promise<void>((resolve) =>
				signal.addEventListener(
					"abort",
					() => {
						aborted = true;
						resolve();
					},
					{ once: true },
				),
			);
			return { stdout: "", stderr: "" };
		},
		"win32",
	);
	const job = installer.start("codex");
	await tick();
	await installer.cancel("codex", "stale-job");
	expect(aborted).toBe(false);
	await installer.cancel("codex", job.id);
	expect(aborted).toBe(true);
	expect(installer.get("codex")?.phase).toBe("cancelled");
});
test("network failures are recoverable and installers use fixed official endpoints", async () => {
	const installer = new AgentInstaller(
		async () => result(false),
		async () => {
			throw new Error("Download failed");
		},
		"win32",
	);
	installer.start("claude");
	await tick();
	expect(installer.get("claude")?.error).toBe("Download failed");
	expect(agentInstallScript("claude")).toContain(
		"https://claude.ai/install.ps1",
	);
	expect(agentInstallScript("codex")).toContain(
		"https://chatgpt.com/codex/install.ps1",
	);
});
