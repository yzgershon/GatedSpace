import { useSyncExternalStore } from "react";

let data = { version: "1.18.66", isDev: true };
const listeners = new Set<() => void>();
export function setVersion(version: string, isDev = true) {
	data = { version, isDev };
	for (const fn of listeners) fn();
}
Object.assign(window, { releaseFixture: { setVersion } });
export const electronTrpc = {
	diagnostics: {
		appVersion: {
			useQuery: () => ({
				data: useSyncExternalStore(
					(fn) => {
						listeners.add(fn);
						return () => {
							listeners.delete(fn);
						};
					},
					() => data,
				),
			}),
		},
	},
};
