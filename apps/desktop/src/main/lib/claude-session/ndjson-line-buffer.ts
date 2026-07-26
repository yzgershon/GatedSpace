/**
 * Reassembles newline-delimited JSON from arbitrarily-chunked stream data.
 *
 * A child process's stdout arrives in chunks that do NOT respect line
 * boundaries: one JSON object can span two chunks, and one chunk can hold many
 * objects plus a trailing partial. This buffer accumulates bytes and yields
 * only COMPLETE lines, retaining any partial for the next chunk.
 *
 * Pure and synchronous so it can be unit-tested without a real process.
 */
export class NdjsonLineBuffer {
	private partial = "";

	/**
	 * Feed a chunk; returns the complete lines it completed (never including a
	 * trailing partial). Handles both "\n" and "\r\n" endings.
	 */
	push(chunk: string): string[] {
		this.partial += chunk;
		const lines: string[] = [];
		let newlineIndex = this.partial.indexOf("\n");
		while (newlineIndex !== -1) {
			// Strip a trailing "\r" so Windows CRLF pipes parse cleanly.
			let line = this.partial.slice(0, newlineIndex);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			lines.push(line);
			this.partial = this.partial.slice(newlineIndex + 1);
			newlineIndex = this.partial.indexOf("\n");
		}
		return lines;
	}

	/**
	 * Return any buffered partial as a final line and clear it. Call once when
	 * the stream closes, in case the last object had no trailing newline.
	 */
	flush(): string[] {
		const rest = this.partial;
		this.partial = "";
		const trimmed = rest.endsWith("\r") ? rest.slice(0, -1) : rest;
		return trimmed.length > 0 ? [trimmed] : [];
	}

	/** True when nothing is buffered (no partial awaiting more data). */
	get isEmpty(): boolean {
		return this.partial.length === 0;
	}
}
