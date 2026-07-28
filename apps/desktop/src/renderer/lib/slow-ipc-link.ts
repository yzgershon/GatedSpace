/**
 * Reports tRPC round trips that take too long.
 *
 * When the app feels stuck, the useful question is WHICH side is stuck: the
 * renderer, the main process, or something below it like a PTY or the file
 * system. Without timing at the boundary there is nothing to distinguish "main
 * is blocked" from "the renderer never asked" — both look like a frozen pane,
 * and both get diagnosed by guesswork.
 *
 * One line per slow call, naming the procedure and the elapsed time, turns that
 * into a fact. Deliberately a threshold rather than a sample: a call that takes
 * two seconds is interesting even if it happens once, and the fast calls (which
 * are almost all of them) cost nothing but a subtraction.
 *
 * Subscriptions are exempt. They are long-lived by design — `claudeSession.stream`
 * stays open for the life of a pane — so measuring their "duration" would report
 * every healthy session as the slowest thing in the app.
 */
import type { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";

/**
 * Anything past this is worth a line. Set above a comfortable local round trip
 * (single-digit ms) with enough headroom that ordinary DB-backed queries don't
 * chatter, but low enough to catch a stall while it is still a stall and not
 * yet a hang.
 */
export const SLOW_IPC_THRESHOLD_MS = 750;

export interface SlowIpcOptions {
	thresholdMs?: number;
	/** Test seam; defaults to console.warn. */
	report?: (message: string, detail: SlowIpcDetail) => void;
	/** Test seam; defaults to performance.now via Date.now fallback. */
	now?: () => number;
}

export interface SlowIpcDetail {
	path: string;
	type: string;
	durationMs: number;
	/** True when the call ended in an error rather than a result. */
	failed: boolean;
}

const defaultNow = (): number =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

export function slowIpcLink<TRouter extends AnyRouter>(
	options: SlowIpcOptions = {},
): TRPCLink<TRouter> {
	const {
		thresholdMs = SLOW_IPC_THRESHOLD_MS,
		now = defaultNow,
		report = (message, detail) => console.warn(message, detail),
	} = options;

	return () => {
		return ({ op, next }) => {
			// Long-lived by design; a duration here would be meaningless.
			if (op.type === "subscription") return next(op);

			const startedAt = now();
			let settled = false;

			const finish = (failed: boolean): void => {
				// A failed call can emit error and complete; only the first counts.
				if (settled) return;
				settled = true;
				const durationMs = Math.round(now() - startedAt);
				if (durationMs < thresholdMs) return;
				report(
					`[ipc] slow ${op.type} ${op.path} took ${durationMs}ms${
						failed ? " (failed)" : ""
					}`,
					{ path: op.path, type: op.type, durationMs, failed },
				);
			};

			return observable((observer) => {
				const subscription = next(op).subscribe({
					next: (result) => observer.next(result),
					error: (err) => {
						finish(true);
						observer.error(err);
					},
					complete: () => {
						finish(false);
						observer.complete();
					},
				});
				return () => {
					// Unsubscribing before completion is a cancelled call, not a slow
					// one — measuring it would blame the caller for hanging up.
					settled = true;
					subscription.unsubscribe();
				};
			});
		};
	};
}
