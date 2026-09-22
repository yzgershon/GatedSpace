import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Preserve preset settings while overriding only this session's speed choice. */
export function withFastSettings(
	args: string[],
	cwd: string,
	fast: boolean,
	read = (path: string) => readFileSync(path, "utf8"),
): string[] {
	const kept: string[] = [];
	let settings: Record<string, unknown> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg !== "--settings" && !arg.startsWith("--settings=")) {
			kept.push(arg);
			continue;
		}
		const value =
			arg === "--settings" ? args[++i] : arg.slice("--settings=".length);
		if (!value)
			throw new Error("Claude preset --settings needs a JSON value or file.");
		const parsed: unknown = JSON.parse(
			value.trim().startsWith("{") ? value : read(resolve(cwd, value)),
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("Claude preset settings must be a JSON object.");
		settings = { ...settings, ...parsed };
	}
	return [
		...kept,
		"--settings",
		JSON.stringify({ ...settings, fastMode: fast }),
	];
}
