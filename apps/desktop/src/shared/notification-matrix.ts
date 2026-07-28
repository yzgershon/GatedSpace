/**
 * Which agent events notify you, and how.
 *
 * Before this, one mute switch governed everything: either every finished turn
 * chimed and popped a banner, or nothing did. The two things are not equally
 * urgent — "your agent is waiting for permission" is something you must act on,
 * "your agent finished" is something you want to know — so they get separate
 * switches on separate channels.
 *
 * The axes are EVENT TYPE × CHANNEL. The parity plan called the second axis
 * "role"; this codebase has no notion of agent roles, and the choice people
 * actually want to make is "sound, banner, both, or neither", so the axis is
 * named for what it is.
 *
 * Defaults reproduce the previous behaviour exactly — everything on. A settings
 * feature that silently stops delivering notifications on upgrade is worse than
 * no settings feature.
 */

export const NOTIFIABLE_EVENT_TYPES = [
	"PermissionRequest",
	"PendingQuestion",
	"Stop",
] as const;

export type NotifiableEventType = (typeof NOTIFIABLE_EVENT_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["sound", "banner"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationMatrix = Record<
	NotifiableEventType,
	Record<NotificationChannel, boolean>
>;

export const DEFAULT_NOTIFICATION_MATRIX: NotificationMatrix = {
	PermissionRequest: { sound: true, banner: true },
	PendingQuestion: { sound: true, banner: true },
	Stop: { sound: true, banner: true },
};

/** Human labels, kept beside the data so the settings grid cannot drift from it. */
export const EVENT_TYPE_LABELS: Record<
	NotifiableEventType,
	{ title: string; description: string }
> = {
	PermissionRequest: {
		title: "Needs permission",
		description:
			"An agent is asking to run something and is blocked until you answer.",
	},
	PendingQuestion: {
		title: "Asked a question",
		description: "An agent stopped to ask you something.",
	},
	Stop: {
		title: "Finished a turn",
		description: "An agent completed what you asked for.",
	},
};

/**
 * A fresh copy, nested objects included.
 *
 * A spread of `DEFAULT_NOTIFICATION_MATRIX` looks like a copy and is not: the
 * per-channel objects stay shared with the module-level constant, so a caller
 * flipping one switch on what it thinks is its own matrix rewrites the default
 * for the rest of the process. That surfaces later as settings changing on
 * their own, a long way from the line that caused it.
 */
function cloneDefaultMatrix(): NotificationMatrix {
	const clone = {} as NotificationMatrix;
	for (const eventType of NOTIFIABLE_EVENT_TYPES) {
		clone[eventType] = { ...DEFAULT_NOTIFICATION_MATRIX[eventType] };
	}
	return clone;
}

export function isNotifiableEventType(
	value: unknown,
): value is NotifiableEventType {
	return (
		typeof value === "string" &&
		(NOTIFIABLE_EVENT_TYPES as readonly string[]).includes(value)
	);
}

/**
 * Reads a stored matrix, filling anything missing from the defaults.
 *
 * Merging rather than validating-and-rejecting is deliberate: adding a new
 * event type later must not blank out a user's saved preferences, and a value
 * corrupted to a non-boolean should fall back to notifying rather than to
 * silence. Every unknown road leads to "you still get told".
 */
export function parseNotificationMatrix(raw: unknown): NotificationMatrix {
	let source: unknown = raw;
	if (typeof raw === "string") {
		try {
			source = JSON.parse(raw);
		} catch {
			return cloneDefaultMatrix();
		}
	}

	if (!source || typeof source !== "object") {
		return cloneDefaultMatrix();
	}

	const stored = source as Record<string, unknown>;
	const result = {} as NotificationMatrix;

	for (const eventType of NOTIFIABLE_EVENT_TYPES) {
		const fallback = DEFAULT_NOTIFICATION_MATRIX[eventType];
		const entry = stored[eventType];
		if (!entry || typeof entry !== "object") {
			result[eventType] = { ...fallback };
			continue;
		}
		const channels = entry as Record<string, unknown>;
		result[eventType] = {
			sound:
				typeof channels.sound === "boolean" ? channels.sound : fallback.sound,
			banner:
				typeof channels.banner === "boolean"
					? channels.banner
					: fallback.banner,
		};
	}

	return result;
}

export function serializeNotificationMatrix(
	matrix: NotificationMatrix,
): string {
	return JSON.stringify(matrix);
}

export function isChannelEnabled(
	matrix: NotificationMatrix,
	eventType: string,
	channel: NotificationChannel,
): boolean {
	if (!isNotifiableEventType(eventType)) return false;
	return matrix[eventType][channel];
}

/**
 * How long one chime holds the floor.
 *
 * Long enough that a burst of agents finishing together produces one sound
 * rather than a stutter, short enough that two genuinely separate moments a few
 * seconds apart are still two sounds. The built-in ringtones run 1–5s, so this
 * is roughly "don't start a new one on top of a short one".
 */
export const SOUND_THROTTLE_MS = 1500;

/**
 * Attention-needing events throttle SEPARATELY from completions.
 *
 * With one shared window, an agent finishing at the same moment another one
 * blocks on a permission prompt would silence the prompt — the app would be
 * quietest at exactly the moment it most needed to interrupt you. Two buckets
 * cost nothing and remove that case.
 */
export type SoundBucket = "attention" | "completion";

export function soundBucketFor(eventType: NotifiableEventType): SoundBucket {
	return eventType === "Stop" ? "completion" : "attention";
}

export interface SoundThrottle {
	/** True if the sound should play now; records the play when it returns true. */
	shouldPlay: (eventType: NotifiableEventType, now: number) => boolean;
}

/**
 * Leading-edge, NOT a trailing debounce. The first event of a burst sounds
 * immediately and the rest are dropped; delaying the chime to the end of a
 * quiet period would mean the noise always arrives after the moment it is
 * about.
 */
export function createSoundThrottle(
	intervalMs: number = SOUND_THROTTLE_MS,
): SoundThrottle {
	const lastPlayed = new Map<SoundBucket, number>();

	return {
		shouldPlay(eventType, now) {
			const bucket = soundBucketFor(eventType);
			const previous = lastPlayed.get(bucket);
			// A clock that jumped backwards (sleep/resume, NTP correction) must not
			// mute the app until real time catches up.
			if (
				previous !== undefined &&
				now >= previous &&
				now - previous < intervalMs
			) {
				return false;
			}
			lastPlayed.set(bucket, now);
			return true;
		},
	};
}
