/**
 * User turns the user did not write.
 *
 * The CLI records harness-injected messages — background-task notifications,
 * slash-command expansions, system reminders — as `type: "user"`, because from
 * the model's point of view that is what they are. Rendered literally, a
 * restored transcript therefore ends with a block of `<task-notification>` XML
 * pinned to the top of the pane as "the last thing you said", which is both
 * wrong and the least useful thing that could be shown there.
 *
 * Detected by METADATA first: the CLI stamps `origin.kind` on every one, and
 * that is authoritative in a way that sniffing the message body is not — a
 * message can legitimately quote `<task-notification>` while discussing it,
 * which is exactly what happens in a conversation about this bug.
 *
 * The content check is a fallback for records written before `origin` existed.
 * It is anchored to the start of the message so quoting one mid-sentence does
 * not erase a real prompt.
 */

const SYNTHETIC_ORIGIN_KINDS = new Set(["task-notification"]);

/**
 * Prefixes that mark a body as machine-authored. Kept narrow on purpose:
 * dropping a real prompt is far worse than showing an odd one, because the
 * prompt is the only record of what was asked.
 */
const SYNTHETIC_PREFIXES = [
	"<task-notification>",
	"<local-command",
	"<command-name>",
	"<command-message>",
	"<system-reminder>",
];

interface RawUserRecord {
	origin?: unknown;
	message?: unknown;
	isMeta?: unknown;
	isVisibleInTranscriptOnly?: unknown;
	isCompactSummary?: unknown;
}

export function isSyntheticUserTurn(raw: RawUserRecord): boolean {
	if (raw.isMeta === true) return true;
	if (raw.isVisibleInTranscriptOnly === true) return true;
	if (raw.isCompactSummary === true) return true;

	const origin = raw.origin;
	if (origin && typeof origin === "object") {
		const kind = (origin as { kind?: unknown }).kind;
		if (typeof kind === "string" && SYNTHETIC_ORIGIN_KINDS.has(kind)) {
			return true;
		}
	}

	const content = (raw.message as { content?: unknown } | undefined)?.content;
	if (typeof content !== "string") return false;
	const head = content.trimStart();
	return SYNTHETIC_PREFIXES.some((prefix) => head.startsWith(prefix));
}
