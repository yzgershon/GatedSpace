import posthogFull from "posthog-js/dist/module.full.no-external";
import type { PostHog } from "posthog-js/react";
import { env } from "../env.renderer";
import { shouldEnableTelemetry } from "./telemetry-gate";

// Cast to standard PostHog type for compatibility with posthog-js/react
export const posthog = posthogFull as unknown as PostHog;

export function initPostHog() {
	const key = env.NEXT_PUBLIC_POSTHOG_KEY;
	if (
		!key ||
		!shouldEnableTelemetry({ key, localOnly: env.NEXT_PUBLIC_LOCAL_ONLY })
	) {
		// A placeholder key is not a real key: the old check was `!key`, which
		// a value like `phc_local_dev_disabled` passes. See telemetry-gate.
		console.log("[posthog] Telemetry disabled, skipping");
		return;
	}

	posthogFull.init(key, {
		api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
		defaults: "2025-11-30",
		capture_pageview: false,
		capture_pageleave: false,
		capture_exceptions: true,
		person_profiles: "identified_only",
		persistence: "localStorage",
		debug: false,
		loaded: (ph) => {
			ph.register({
				app_name: "desktop",
				platform: window.navigator.platform,
			});
		},
	});
}
