import { expect, test } from "bun:test";
import { withFastSettings } from "./fast-settings";

test("speed is session-scoped and preserves inline preset settings", () => {
	expect(
		withFastSettings(
			[
				"--model",
				"opus",
				"--settings",
				'{"fastMode":true,"env":{"KEEP":"yes"}}',
			],
			"/workspace",
			false,
		),
	).toEqual([
		"--model",
		"opus",
		"--settings",
		'{"fastMode":false,"env":{"KEEP":"yes"}}',
	]);
});
test("settings file keeps hooks and other settings when speed changes", () => {
	expect(
		withFastSettings(
			["--settings=custom.json"],
			"/workspace",
			true,
			() => '{"hooks":{},"language":"English"}',
		),
	).toEqual([
		"--settings",
		'{"hooks":{},"language":"English","fastMode":true}',
	]);
});
