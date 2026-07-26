/**
 * Reconciles a user's configured Claude agent preset with the session pane's
 * own launch flags.
 *
 * A preset is free-form: it's whatever the user put in Settings → Agents, and
 * the default one is already `claude --permission-mode acceptEdits`. Most of it
 * should be honored — custom MCP configs, extra directories, model pins. But a
 * few flags belong to this pane and can't be overridden without breaking it:
 * the stream-json protocol flags are how we read the process at all, and
 * permission mode / resume are driven by the composer and the pane's own state.
 *
 * So preset args are filtered rather than trusted wholesale or ignored
 * wholesale. Dropping a flag silently is the right call here — the alternative
 * is a session that either can't be parsed or quietly disagrees with the
 * controls the user is looking at.
 */

/** Boolean flags we set ourselves; a preset repeating them is harmless noise. */
const OWNED_BOOLEAN_FLAGS = new Set([
	"-p",
	"--print",
	"--verbose",
	"--include-partial-messages",
	"-c",
	"--continue",
]);

/** Flags we own that consume the following token as their value. */
const OWNED_VALUE_FLAGS = new Set([
	"--input-format",
	"--output-format",
	"--permission-mode",
	"--resume",
]);

export interface SanitizePresetArgsOptions {
	/**
	 * True when the pane already passed `--model`. A preset's model pin is
	 * honored otherwise — that's a legitimate thing to configure per agent.
	 */
	hasModel?: boolean;
}

/**
 * Strip the flags this pane controls, keeping everything else in order.
 * Handles both `--flag value` and `--flag=value` spellings.
 */
export function sanitizePresetArgs(
	args: readonly string[],
	options: SanitizePresetArgsOptions = {},
): string[] {
	const valueFlags = new Set(OWNED_VALUE_FLAGS);
	if (options.hasModel) valueFlags.add("--model");

	const kept: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const eq = arg.indexOf("=");
		const name = eq === -1 ? arg : arg.slice(0, eq);

		if (OWNED_BOOLEAN_FLAGS.has(name)) continue;
		if (valueFlags.has(name)) {
			// `--flag=value` is self-contained; `--flag value` eats the next token.
			if (eq === -1) i++;
			continue;
		}
		kept.push(arg);
	}
	return kept;
}
