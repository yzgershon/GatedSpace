/**
 * Coalesces PTY output chunks into one xterm.write() per animation frame.
 *
 * Agent CLIs (Claude Code especially) emit full-screen repaints as many small
 * PTY chunks. Writing each chunk individually triggers an xterm parse/render
 * cycle per chunk, which overwhelms the renderer during streaming output.
 * Batching to the display refresh rate makes the cost per frame constant
 * regardless of chunk count. See issues #2241 / #2244.
 */

/**
 * Pending-byte ceiling. requestAnimationFrame stalls while the window is
 * hidden (Electron throttles backgrounded renderers), so without a cap the
 * buffer could grow unboundedly during a background firehose. Exceeding the
 * cap flushes synchronously, bounding memory at the cost of one early write.
 */
export const MAX_PENDING_BYTES = 1024 * 1024;

/**
 * How often back-pressure forced an early write, and how much it moved.
 *
 * Overflow is not an error — the synchronous flush is the correct response and
 * nothing is lost. But a pane that overflows continuously is a pane whose
 * renderer is behind the PTY, and that is invisible from the outside: it looks
 * like "the terminal feels laggy" with nothing to point at. These counters are
 * what turn that into a number.
 */
export interface WriteCoalescerStats {
	/** Early flushes caused by exceeding MAX_PENDING_BYTES. */
	overflowFlushes: number;
	/** Total bytes written by those flushes. */
	overflowBytes: number;
	/** Largest single batch handed to xterm, in bytes. */
	peakBatchBytes: number;
}

export interface WriteCoalescer {
	/** Queue PTY bytes for the next frame's write. */
	push(chunk: Uint8Array): void;
	/**
	 * Write everything pending right now. Call before writing anything else
	 * to the terminal (exit notices, error lines) so output stays ordered.
	 */
	flushSync(): void;
	/** Flush remaining bytes and stop accepting new ones. */
	dispose(): void;
	/** Back-pressure counters since creation. */
	stats(): WriteCoalescerStats;
}

export interface WriteCoalescerOptions {
	/**
	 * Called on each overflow-triggered flush, with the running totals.
	 *
	 * Deliberately NOT a "bytes were dropped" hook: this coalescer never drops.
	 * Bounding memory by flushing early keeps every byte and moves the cost to
	 * one unbatched write, which is the right trade for a terminal — losing
	 * agent output to save a frame would be a much worse bargain.
	 */
	onOverflow?: (stats: WriteCoalescerStats) => void;
}

export function createWriteCoalescer(
	write: (data: Uint8Array) => void,
	options: WriteCoalescerOptions = {},
): WriteCoalescer {
	let pending: Uint8Array[] = [];
	let pendingBytes = 0;
	let frameId: number | null = null;
	let disposed = false;
	let overflowFlushes = 0;
	let overflowBytes = 0;
	let peakBatchBytes = 0;

	const snapshot = (): WriteCoalescerStats => ({
		overflowFlushes,
		overflowBytes,
		peakBatchBytes,
	});

	function flushSync() {
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
		}
		if (pendingBytes === 0) return;
		let batch: Uint8Array;
		if (pending.length === 1) {
			batch = pending[0] as Uint8Array;
		} else {
			batch = new Uint8Array(pendingBytes);
			let offset = 0;
			for (const chunk of pending) {
				batch.set(chunk, offset);
				offset += chunk.length;
			}
		}
		pending = [];
		pendingBytes = 0;
		if (batch.length > peakBatchBytes) peakBatchBytes = batch.length;
		write(batch);
	}

	function push(chunk: Uint8Array) {
		if (disposed) return;
		pending.push(chunk);
		pendingBytes += chunk.length;
		if (pendingBytes > MAX_PENDING_BYTES) {
			overflowFlushes++;
			overflowBytes += pendingBytes;
			flushSync();
			options.onOverflow?.(snapshot());
			return;
		}
		if (frameId === null) {
			frameId = requestAnimationFrame(() => {
				frameId = null;
				flushSync();
			});
		}
	}

	return {
		push,
		flushSync,
		dispose() {
			if (disposed) return;
			flushSync();
			disposed = true;
		},
		stats: snapshot,
	};
}
