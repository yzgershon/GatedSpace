import { describe, expect, test } from "bun:test";
import { agentSetupCommand } from "./agent-setup-command";

describe("native provider setup", () => {
	for (const agent of ["codex", "claude"] as const) {
		test(`${agent} sign-in never installs anything implicitly`, () => {
			const command = agentSetupCommand(agent, false);
			const script = Buffer.from(
				command.split(" ").at(-1) ?? "",
				"base64",
			).toString("utf16le");
			expect(script).not.toContain("Invoke-RestMethod");
			expect(script).toContain(agent === "codex" ? "login" : "auth login");
			expect(script).toContain(".local\\bin");
			expect(script).toContain(".superset");
		});
		test(`${agent} setup uses only the provider's official installer`, () => {
			const script = Buffer.from(
				agentSetupCommand(agent, true).split(" ").at(-1) ?? "",
				"base64",
			).toString("utf16le");
			expect(script).toContain(
				agent === "codex"
					? "https://chatgpt.com/codex/install.ps1"
					: "https://claude.ai/install.ps1",
			);
		});
	}
});
