import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PERSONAL_BACKEND } from "../../apps/desktop/vite/personal-backend";

/** One contract for both compiled preflight and the extracted installer. */
export const REQUIRED_MARKERS: readonly string[] = [
	"browser_tabs",
	"browser_select",
	"agentSessionKey",
	"Browser panel did not return its tabs.",
	"gs-tabrail-window",
	"gs-tabrail-fixed",
	"gs-tabrail-close",
	"codex-question-option",
	"codex-question-custom",
	"session-message-queue",
	"message-queue-row",
	"Queue paused",
	"pinned-claude-sessions.json",
	"session-collection",
	"collection-panel-title",
	"All agents",
	"This queue belongs to another conversation",
	"GATEDSPACE_NATIVE_SESSION",
	"notifiedByDesktop",
	"gs-agent-breathe",
	"sessionPaneId",
	"Finished its response",
	"gatedspace-latest",
	"Open GatedSpace for the latest session status.",
	"topbar-build-slot",
	"workspace-topbar",
	"topbar-actions",
	"Installer builds",
	"build-status-chip",
	"build-status-popover",
	"Build updates stopped.",
	"Ready requires verified installers",
	"session-changes-pill",
	"session-changes-dock",
	"Changes in this task",
	"Show fewer files",
	"codex-changes-expand",
	"6.55",
	"computer_tools",
	"computer_call",
	"Enable for this pane",
	"Stop computer control",
	"Control+Alt+Shift+Escape",
	"ANONYMIZED_TELEMETRY",
	"windows-mcp==",
	"0.8.5",
	"Computer control was stopped.",
	"browserInputPoint",
	"previewScales",
	"Galaxy S24",
	"Rotate Galaxy S24",
	"enableDeviceEmulation",
	"gs-browser-preview-controls",
	"gs-browser-stage",
	"data-expanded",
	"GatedSpace Sync",
	"Conversations on your PCs",
	"Sync now",
	"Set up my first PC",
	"gatedspace-sync.vercel.app",
	"A recovery key is already stored on this computer.",
	"Another PC has newer work",
	"A checkpoint is already queued. Retry the transfer first.",
	"GatedSpace-recovery-key.txt",
	"Mobile access could not start. Retrying automatically.",
	"/api/health/ready",
	"gs-draft:",
	"agent-filters",
	"/usage/codex",
	"This request ID belongs to a different message.",
	"Other: ",
	"Your desktop, within reach.",
	"Invalid or expired auth session",
	"Codex history did not advance.",
	"prompt-navigator",
	"Go to prompt",
	"Prompt history",
	"Load earlier prompts",
	"codex-live-activity",
	"codex-prompt-overlay",
	"data-prompt-id",
	"data-pinned-id",
	"codex-pinned-images",
	"codex-activity-words",
	"codex-word-sheen",
	"codex-question-card",
	"request_user_input_async",
	"turn/steer",
	"Question displayed. Continue independent work.",
	"Command and output",
	"codex-shell-content",
	"codex-turn-changes",
	"codex-review-button",
	"codex-turn-review",
	"codex-review-file",
	"codex-review-raw",
	"codex-review",
	"session-image-preview",
	"session-image-lightbox",
	"Files edited in this task",
	"This task",
	"pinned-codex-sessions.json",
	"host-project-metadata",
	"gatedspace-session-provider",
	"claude-acct",
	"Message Claude",
	"gs-pane-title",
	"Segoe UI Variable Display",
	"gatedspace_browser",
	"--permission-prompt-tool",
	"stdio",
	"local_permissions",
	"codex-work-heading",
	"codex-action-motion",
	"codex-tool-details",
	"weekly window",
	"Running commands",
	"Writing response",
	"item/commandExecution/outputDelta",
	"Reasoning summary",
	"Viewed a browser image",
	"local-user-",
	'GATEDSPACE_PERSONAL: "1"',
	'NEXT_PUBLIC_RELEASE_BUILD: ""',
	"[terminal] Mouse coordinate services unavailable",
	"Updater ready; waiting for the application to exit.",
	"No completed personal update is available. Check for updates again.",
	"Codex conversation",
	"Message Codex",
	"session-model-trigger",
	"session-settings",
	"session-growing-input",
	"session-effort-range",
	"session-fast-toggle",
	"project/list",
	"project/create",
	"thread/metadata/update",
	"collaborationMode",
	"serviceTier",
	"account/rateLimits/read",
	"skills/list",
	"codex-native",
	"thread/items/list",
	"thread/fork",
	"thread/unsubscribe",
	"workspaceWrite",
	"gatedspace:workspace-tools:v1:",
	"gs-tool-chooser",
	"Toggle right panel",
	"Toggle bottom panel",
	"Unsupported xterm WebGL renderer viewport interface",
	"Unsupported xterm shared WebGL atlas interface",
	'NEXT_PUBLIC_LOCAL_ONLY: ""',
];

export type Bundle = ReadonlyMap<string, Buffer>;

/** Check concrete env bindings, not schema defaults or URLs in unrelated code. */
export function validatePersonalBackend(files: Bundle) {
	for (const scope of ["main", "renderer"] as const) {
		const source = [...files]
			.filter(([name]) =>
				scope === "main"
					? name === "dist/main/index.js"
					: name.startsWith("dist/renderer/") && name.endsWith(".js"),
			)
			.map(([, data]) => data.toString())
			.join("\n");
		const keys =
			scope === "main"
				? ([
						"NEXT_PUBLIC_API_URL",
						"NEXT_PUBLIC_WEB_URL",
						"NEXT_PUBLIC_STREAMS_URL",
					] as const)
				: ([
						"NEXT_PUBLIC_API_URL",
						"NEXT_PUBLIC_WEB_URL",
						"NEXT_PUBLIC_ELECTRIC_URL",
					] as const);
		for (const key of keys) {
			const pattern = new RegExp(`${key}:\\s*("[^"\\r\\n]*")`, "g");
			const bindings = [...source.matchAll(pattern)].map(
				(match) => JSON.parse(match[1]) as string,
			);
			assert.ok(bindings.length, `Missing personal ${scope} binding: ${key}`);
			for (const value of bindings) {
				assert.equal(
					value,
					PERSONAL_BACKEND[key],
					`Wrong personal ${scope} backend: ${key}`,
				);
			}
		}
	}
}

export function readCompiledBundle(repo: string): Map<string, Buffer> {
	const root = join(repo, "apps/desktop");
	const files = new Map<string, Buffer>();
	function visit(relative: string) {
		for (const entry of readdirSync(join(root, relative), {
			withFileTypes: true,
		})) {
			const name = `${relative}/${entry.name}`;
			if (entry.isDirectory()) visit(name);
			else if (/\.(js|css|html)$/.test(name))
				files.set(name, readFileSync(join(root, name)));
		}
	}
	visit("dist");
	assert.ok(files.size, "Compiled bundle is empty");
	return files;
}

export function validatePersonalBundle(files: Bundle) {
	validatePersonalBackend(files);
	const scripts = [...files]
		.filter(([name]) => name.endsWith(".js"))
		.map(([, data]) => data.toString())
		.join("\n");
	const styles = [...files]
		.filter(([name]) => name.endsWith(".css"))
		.map(([, data]) => data.toString())
		.join("\n");
	const sources = `${scripts}\n${styles}`;
	const missing = REQUIRED_MARKERS.filter(
		(marker) => !sources.includes(marker),
	);
	assert.equal(
		missing.length,
		0,
		`Bundle contract missing: ${missing.join(", ")}`,
	);
	// An unused CSS selector is not executable UI. Behavior is covered by the compiled UI checks.
	assert.ok(
		!scripts.includes("gs-tab-switcher"),
		"Removed tab dropdown remains in JavaScript",
	);
	assert.ok(
		!sources.includes("workspace-topbar-shells-slot"),
		"Removed shell portal remains in bundle",
	);
	for (const marker of [
		"GatedSpace control border",
		"The desktop control indicator closed.",
		"control-border",
		"control-toolbar",
		"Computer control ready",
		"Reading the screen",
	]) {
		assert.ok(sources.includes(marker), `Missing overlay marker ${marker}`);
	}
	assert.ok(
		files.has("dist/preload/computer-overlay.js"),
		"Missing overlay preload",
	);
	assert.ok(
		files
			.get("dist/renderer/computer-overlay.html")
			?.toString()
			.includes("control-stop"),
		"Missing overlay stop control",
	);
	const host = files.get("dist/main/host-service.js");
	assert.ok(host, "Missing host service");
	assert.ok(
		!host.toString().includes("countUntrackedFileLines"),
		"Untracked line scan returned",
	);
	assert.ok(
		!host.toString().includes("watchGit(worktreePath"),
		"Worktree watcher returned",
	);
	const rule = /\.codex-native\s*\{([^}]+)\}/.exec(styles);
	assert.ok(rule, "Missing Codex CSS");
	assert.match(rule[1], /width:\s*100%/);
	assert.match(rule[1], /flex:\s*1 1 (0%?|0px)/);
	assert.match(
		scripts,
		/\/Windows\/i\.test\(navigator\.userAgent\)\s*\?\s*["']dom["']\s*:\s*["']webgl["']/,
		"Missing Windows native text rendering",
	);
	return { matchedFiles: files.size, requiredMarkers: REQUIRED_MARKERS.length };
}

/** Equality is symmetric: a missing packaged chunk must fail as well as an altered one. */
export function compareBundles(compiled: Bundle, packaged: Bundle) {
	assert.equal(
		packaged.size,
		compiled.size,
		"Packaged asset inventory differs from the compiled app",
	);
	for (const [name, expected] of compiled) {
		const actual = packaged.get(name);
		assert.ok(actual, `Missing packaged asset: ${name}`);
		assert.ok(actual.equals(expected), `Packaged asset differs: ${name}`);
	}
}
