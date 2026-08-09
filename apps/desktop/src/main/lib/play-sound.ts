import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

interface PlaySoundCallbacks {
	onComplete?: () => void;
	isCanceled?: () => boolean;
	onProcessChange?: (process: ChildProcess) => void;
}

/**
 * Plays a sound file at the given volume using platform-specific commands.
 * Returns the primary ChildProcess, or null if playback was skipped.
 *
 * On macOS, volume is controlled via afplay -v (0.0-1.0).
 * On Linux, volume is controlled via paplay --volume (0-65536), with aplay fallback.
 */
export function playSoundFile(
	soundPath: string,
	volume: number = 100,
	callbacks?: PlaySoundCallbacks,
): ChildProcess | null {
	if (!existsSync(soundPath)) {
		console.warn(`[play-sound] Sound file not found: ${soundPath}`);
		return null;
	}

	const volumeDecimal = volume / 100;

	/*
	 * Windows had no branch here at all, so every notification sound on this
	 * platform spawned `paplay` — a Linux tool — failed with ENOENT, fell through
	 * to `aplay`, failed again, and reported nothing. The chime, the Settings
	 * preview button and every custom ringtone were silent, and the settings
	 * page looked broken rather than unimplemented.
	 *
	 * Windows ships no command-line MP3 player, and these files are MP3.
	 * `System.Media.SoundPlayer` is WAV-only, so the Media Player COM object is
	 * the one thing that is always present and can both decode MP3 and set a
	 * volume.
	 *
	 * The wait loop matters: the COM object plays asynchronously, so a script
	 * that returns immediately takes the sound with it when the process exits.
	 * playState 3 is "playing"; the leading sleep gives it time to reach that
	 * state before the loop reads it, otherwise the loop exits before playback
	 * has begun.
	 */
	if (process.platform === "win32") {
		// Single-quoted PowerShell literal: doubling is the escape, and it keeps
		// a path containing quotes from ending the string and running as code.
		const psPath = soundPath.replace(/'/g, "''");
		const wmpVolume = Math.round(Math.max(0, Math.min(100, volume)));
		return execFile(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-WindowStyle",
				"Hidden",
				"-Command",
				`$ErrorActionPreference='Stop';` +
					`$p = New-Object -ComObject WMPlayer.OCX;` +
					`$p.settings.volume = ${wmpVolume};` +
					`$p.URL = '${psPath}';` +
					`$p.controls.play();` +
					`Start-Sleep -Milliseconds 400;` +
					`while ($p.playState -eq 3) { Start-Sleep -Milliseconds 100 };` +
					`$p.close()`,
			],
			(error) => {
				if (error && !callbacks?.isCanceled?.()) {
					console.warn("[play-sound] Windows playback failed:", error);
				}
				callbacks?.onComplete?.();
			},
		);
	}

	if (process.platform === "darwin") {
		return execFile("afplay", ["-v", volumeDecimal.toString(), soundPath], () =>
			callbacks?.onComplete?.(),
		);
	}

	// Linux: paplay --volume accepts 0-65536 (65536 = 100%)
	const paVolume = Math.round(volumeDecimal * 65536);
	return execFile(
		"paplay",
		["--volume", paVolume.toString(), soundPath],
		(error) => {
			if (error) {
				if (callbacks?.isCanceled?.()) {
					callbacks?.onComplete?.();
					return;
				}
				if (volume === 0) {
					callbacks?.onComplete?.();
					return;
				}
				const fallback = execFile("aplay", [soundPath], () =>
					callbacks?.onComplete?.(),
				);
				callbacks?.onProcessChange?.(fallback);
				return;
			}
			callbacks?.onComplete?.();
		},
	);
}
