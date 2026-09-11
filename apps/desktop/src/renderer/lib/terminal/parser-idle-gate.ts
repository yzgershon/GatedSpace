// xterm resize re-enters the parser. If an async parser handler is paused
// mid-write (inline image decode), wait for the write callback before resizing.

type WriteFn = (data: string | Uint8Array, callback?: () => void) => void;

export interface ParserIdleGate {
	pending: number;
	queued: (() => void) | null;
	deadline: ReturnType<typeof setTimeout> | null;
}

/**
 * How long a parked job may wait for the parser before it runs anyway.
 *
 * WITHOUT A DEADLINE THIS GATE COULD SWALLOW A FIT FOREVER, and that is the
 * terminal-is-cut-off bug. `pending` only returns to zero once every wrapped
 * `write()` has invoked its callback, so an agent streaming output keeps it
 * above zero; the fit parks in `queued`; and the next `detachFromContainer` —
 * which `Tab.tsx` triggers on ANY layout change, because panes remount — calls
 * `cancelParserIdleWork` and throws the parked fit away without rescheduling
 * it. The terminal then keeps the geometry it was BORN with (the saved dims of
 * whatever pane last held that id), the `attached` handler faithfully reports
 * that same geometry to the pty, and both ends agree on a grid that is wider
 * and taller than the box it has to paint into. Everything past the container's
 * edge is clipped: the right-hand end of every line disappears, and rows fall
 * off the bottom.
 *
 * Nothing recovers it either, because the ResizeObserver only fires on a
 * CHANGE — the container was already its final size — which is why dragging a
 * split fixed it and nothing else did.
 *
 * Resizing while a parser handler is paused is the thing this gate exists to
 * avoid, so the deadline is a deliberate trade: a torn repaint in the rare
 * mid-image-decode case, against a permanently wrong grid. 250ms is far longer
 * than any normal drain.
 */
const DEFAULT_MAX_WAIT_MS = 250;

export function createParserIdleGate(): ParserIdleGate {
	return { pending: 0, queued: null, deadline: null };
}

function clearDeadline(gate: ParserIdleGate): void {
	if (gate.deadline === null) return;
	clearTimeout(gate.deadline);
	gate.deadline = null;
}

export function cancelParserIdleWork(gate: ParserIdleGate): void {
	gate.queued = null;
	clearDeadline(gate);
}

function flushQueued(gate: ParserIdleGate): void {
	if (gate.pending !== 0) return;
	const fn = gate.queued;
	if (!fn) return;
	gate.queued = null;
	clearDeadline(gate);
	fn();
}

export function wrapWrite(gate: ParserIdleGate, write: WriteFn): WriteFn {
	return (data, callback) => {
		gate.pending++;
		write(data, () => {
			try {
				callback?.();
			} finally {
				gate.pending--;
				if (gate.pending === 0 && gate.queued) {
					queueMicrotask(() => flushQueued(gate));
				}
			}
		});
	};
}

export function runWhenParserIdle(
	gate: ParserIdleGate,
	fn: () => void,
	maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
): void {
	if (gate.pending === 0) {
		// A newer job supersedes whatever was parked, deadline included.
		cancelParserIdleWork(gate);
		fn();
		return;
	}
	gate.queued = fn;
	/*
	 * The FIRST deadline wins; a later call must not push it out.
	 *
	 * `queued` is a single slot, so a terminal that is both busy and resizing
	 * replaces the parked job over and over. Re-arming the timer each time would
	 * let a steady stream of calls postpone it indefinitely — the same
	 * starvation this deadline exists to end.
	 */
	if (gate.deadline !== null) return;
	gate.deadline = setTimeout(() => {
		gate.deadline = null;
		const queued = gate.queued;
		gate.queued = null;
		queued?.();
	}, maxWaitMs);
}
