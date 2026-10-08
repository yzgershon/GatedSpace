import { expect, test } from "bun:test";
import { CLAUDE_TITLE_ARGS, titleProcessEnvironment } from "./generate";

test("subscription naming disables tools, hooks, persistence and inherited auth overrides", () => {
	const args = CLAUDE_TITLE_ARGS;
	const inherited = {
		ANTHROPIC_API_KEY: "placeholder",
		ANTHROPIC_AUTH_TOKEN: "placeholder",
		ANTHROPIC_BASE_URL: "http://invalid",
		CLAUDECODE: "nested",
		PATH: "system-bin",
	};
	const environment = titleProcessEnvironment(
		inherited,
		{ ELECTRON_RUN_AS_NODE: "1" },
		"C:/fake-profile",
	);
	expect(args).toContain("--no-session-persistence");
	expect(args[args.indexOf("--tools") + 1]).toBe("");
	expect(args[args.indexOf("--settings") + 1]).toBe('{"disableAllHooks":true}');
	expect(args).toContain("--strict-mcp-config");
	expect(args).toContain("--disable-slash-commands");
	expect(environment.CLAUDE_CONFIG_DIR).toBe("C:/fake-profile");
	expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
	expect(environment.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
	expect(environment.ANTHROPIC_BASE_URL).toBeUndefined();
	expect(environment.CLAUDECODE).toBeUndefined();
	expect(environment.ELECTRON_RUN_AS_NODE).toBe("1");
	expect(environment.PATH).toBe("system-bin");
	expect(inherited.ANTHROPIC_API_KEY).toBe("placeholder");
});
