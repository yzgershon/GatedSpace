import { settings } from "@superset/local-db";
import {
	DEFAULT_NOTIFICATION_MATRIX,
	type NotificationMatrix,
	parseNotificationMatrix,
} from "../../shared/notification-matrix";
import {
	CUSTOM_RINGTONE_ID,
	DEFAULT_RINGTONE_ID,
	getRingtoneFilename,
} from "../../shared/ringtones";
import { getCustomRingtonePath } from "./custom-ringtones";
import { localDb } from "./local-db";
import { playSoundFile } from "./play-sound";
import { getSoundPath } from "./sound-paths";

/**
 * The event × channel matrix, straight from the settings row.
 *
 * Read on every event rather than cached: it is a single indexed row, and a
 * cache here would mean settings changes not taking effect until relaunch.
 * Any failure resolves to the defaults, so a database problem cannot silently
 * stop notifications.
 */
export function getNotificationMatrix(): NotificationMatrix {
	try {
		const settingsRow = localDb.select().from(settings).get();
		return parseNotificationMatrix(settingsRow?.notificationMatrix);
	} catch {
		return DEFAULT_NOTIFICATION_MATRIX;
	}
}

/**
 * Checks if notification sounds are muted.
 */
function areNotificationSoundsMuted(): boolean {
	try {
		const settingsRow = localDb.select().from(settings).get();
		return settingsRow?.notificationSoundsMuted ?? false;
	} catch {
		return false;
	}
}

/**
 * Gets the selected ringtone path from the database.
 * Falls back to default ringtone if the stored ID is invalid/stale.
 */
function getSelectedRingtonePath(): string | null {
	const defaultFilename = getRingtoneFilename(DEFAULT_RINGTONE_ID);
	const defaultPath = getSoundPath(defaultFilename);

	try {
		const settingsRow = localDb.select().from(settings).get();
		const selectedId = settingsRow?.selectedRingtoneId ?? DEFAULT_RINGTONE_ID;

		// Legacy: "none" was previously used before the muted toggle existed
		if (selectedId === "none") {
			return null;
		}

		if (selectedId === CUSTOM_RINGTONE_ID) {
			return getCustomRingtonePath() ?? defaultPath;
		}

		const filename = getRingtoneFilename(selectedId);
		// Fall back to default if stored ID is stale/unknown
		return filename ? getSoundPath(filename) : defaultPath;
	} catch {
		return defaultPath;
	}
}

/**
 * Plays the notification sound based on user's selected ringtone.
 * Uses platform-specific commands to play the audio file.
 */
export function playNotificationSound(): void {
	// Check if sounds are muted
	if (areNotificationSoundsMuted()) {
		return;
	}

	const soundPath = getSelectedRingtonePath();

	// No sound if "none" is selected
	if (!soundPath) {
		return;
	}

	// Get volume from settings
	let volume = 100;
	try {
		const settingsRow = localDb.select().from(settings).get();
		const raw = settingsRow?.notificationVolume;
		volume =
			typeof raw === "number" && Number.isFinite(raw)
				? Math.max(0, Math.min(100, raw))
				: 100;
	} catch (err) {
		console.warn(
			"[notification-sound] Failed to read notification volume setting",
			err,
		);
		volume = 100;
	}

	playSoundFile(soundPath, volume);
}
