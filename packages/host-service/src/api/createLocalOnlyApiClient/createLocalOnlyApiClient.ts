import type { ApiClient } from "../../types";

/**
 * Thrown by every cloud API call in local-only mode. Call sites that mirror
 * to the cloud best-effort already tolerate rejections; anything that must
 * branch on "cloud is off by design" (rather than a network failure) can
 * check for this error by name.
 */
export class CloudDisabledError extends Error {
	constructor(path: string) {
		super(`Cloud API is disabled in local-only mode (call: ${path})`);
		this.name = "CloudDisabledError";
	}
}

export function isCloudDisabledError(error: unknown): boolean {
	return error instanceof Error && error.name === "CloudDisabledError";
}

function buildRejectingProxy(path: string[]): unknown {
	// Callable target so both property access (router traversal) and
	// invocation (.query()/.mutate()) work on the same proxy.
	const target = () => {};
	return new Proxy(target, {
		get(_target, prop) {
			if (typeof prop === "symbol") return undefined;
			// Keep thenable checks from treating the proxy as a promise.
			if (prop === "then") return undefined;
			return buildRejectingProxy([...path, prop]);
		},
		apply() {
			return Promise.reject(new CloudDisabledError(path.join(".")));
		},
	});
}

/**
 * ApiClient stand-in for local-only mode: any `api.x.y.query()/mutate()`
 * rejects with CloudDisabledError instead of hitting the network.
 */
export function createLocalOnlyApiClient(): ApiClient {
	return buildRejectingProxy([]) as ApiClient;
}
