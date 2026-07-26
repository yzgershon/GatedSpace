/**
 * Resolves the user's configured Claude agent preset into launch options for a
 * session pane.
 *
 * Without this, the pane would ignore Settings → Agents entirely and launch a
 * bare `claude`, quietly dropping whatever the user configured — custom MCP
 * configs, extra directories, a pinned model, a wrapper binary. The preset's
 * args are filtered in main (`sanitizePresetArgs`) so it still can't break the
 * stream-json protocol or contradict the composer's own mode control.
 *
 * `ready` matters: the pane must not spawn before this settles, or the first
 * session of a cold start would silently launch without the user's preset.
 */
import { useMemo } from "react";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export interface ClaudePresetLaunch {
	binary?: string;
	extraArgs?: string[];
	env?: Record<string, string>;
}

export function useClaudePresetLaunch(): {
	launch: ClaudePresetLaunch;
	ready: boolean;
} {
	const { activeHostUrl } = useLocalHostService();
	const query = useV2AgentConfigs(activeHostUrl);

	// A failed lookup shouldn't strand the pane — launching a bare `claude` is
	// a worse outcome than not launching at all only if we pretend it's the
	// user's config, so fall through with nothing rather than block forever.
	const ready = !activeHostUrl || query.isSuccess || query.isError;

	// Memoised on the query data so the returned object keeps a stable identity
	// across renders — it feeds an effect that spawns a process, and a fresh
	// object every render would re-fire it.
	const launch = useMemo<ClaudePresetLaunch>(() => {
		const claude = (query.data ?? [])
			.filter((config) => config.presetId === "claude")
			.sort((a, b) => a.order - b.order)[0];
		if (!claude) return {};
		return {
			binary: claude.command || undefined,
			extraArgs: claude.args.length > 0 ? claude.args : undefined,
			env: Object.keys(claude.env).length > 0 ? claude.env : undefined,
		};
	}, [query.data]);

	return { launch, ready };
}
