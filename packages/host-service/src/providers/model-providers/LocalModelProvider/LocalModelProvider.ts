import type { ModelProviderRuntimeResolver } from "../types";
import {
	buildAnthropicRuntimeEnv,
	getAnthropicEnvConfig,
	stripAnthropicCredentialEnvVariables,
} from "../utils/anthropic-runtime-env";
import { applyRuntimeEnv } from "../utils/runtime-env";
import {
	getActiveClaudeConfigDir,
	hasUsableCredential,
	resolveAnthropicCredential,
	resolveOpenAICredential,
} from "./utils";

const CLEANUP_KEYS = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"OPENAI_API_KEY",
	"OPENAI_AUTH_TOKEN",
] as const;

interface LocalModelProviderOptions {
	anthropicEnvConfigPath?: string;
}

export class LocalModelProvider implements ModelProviderRuntimeResolver {
	private readonly anthropicEnvConfigPath?: string;
	private currentRuntimeEnv: Record<string, string> = {};

	constructor(options?: LocalModelProviderOptions) {
		this.anthropicEnvConfigPath = options?.anthropicEnvConfigPath;
	}

	private async resolveRuntimeEnv(): Promise<{
		env: Record<string, string>;
		cleanupKeys: string[];
		hasUsableRuntimeEnv: boolean;
	}> {
		const anthropicCredential = await resolveAnthropicCredential();
		const openaiCredential = resolveOpenAICredential();
		const anthropicEnvConfig = getAnthropicEnvConfig({
			configPath: this.anthropicEnvConfigPath,
		});
		const runtimeEnv = buildAnthropicRuntimeEnv(
			stripAnthropicCredentialEnvVariables(anthropicEnvConfig.variables),
		);

		return {
			env: runtimeEnv,
			cleanupKeys: [...CLEANUP_KEYS],
			hasUsableRuntimeEnv:
				hasUsableCredential(anthropicCredential) ||
				hasUsableCredential(openaiCredential),
		};
	}

	async hasUsableRuntimeEnv(): Promise<boolean> {
		return (await this.resolveRuntimeEnv()).hasUsableRuntimeEnv;
	}

	async prepareRuntimeEnv(): Promise<void> {
		// Point the in-process runtime (mastracode honors CLAUDE_CONFIG_DIR) at the
		// active Claude account, so it authenticates with the same account the gate
		// found credentials for — not a stale ~/.claude default. CLI agents run in
		// their own processes with their own CLAUDE_CONFIG_DIR, so this only affects
		// the chat runtime.
		const activeConfigDir = getActiveClaudeConfigDir();
		if (activeConfigDir) {
			process.env.CLAUDE_CONFIG_DIR = activeConfigDir;
		}

		const runtimeEnv = await this.resolveRuntimeEnv();
		this.currentRuntimeEnv = applyRuntimeEnv(
			runtimeEnv.env,
			runtimeEnv.cleanupKeys,
			this.currentRuntimeEnv,
		);
	}
}
