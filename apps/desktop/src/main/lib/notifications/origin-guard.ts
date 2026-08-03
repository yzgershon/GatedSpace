// Whether a request to the local hook server came from a web page.
//
// This server listens on a FIXED loopback port (51741) and its routes take
// everything from the query string with no credential. That is fine for its
// real callers — shell hook scripts running curl — but it used to also send
// `Access-Control-Allow-Origin: *`, which does nothing for curl and everything
// for a browser: any page the user visited could reach the port, forge agent
// lifecycle events, and read the replies.
//
// curl sends no Origin header. Browsers always attach one to a cross-origin
// request. So the presence of the header is the signal.
//
// Kept free of express/electron imports so it can be unit tested.

/**
 * True when the request should be refused.
 *
 * Anything carrying an Origin came from a page and is therefore not one of our
 * hook scripts. Absent header (curl, the OS opening a deep link) passes.
 */
export function shouldRejectOrigin(origin: string | undefined | null): boolean {
	return origin !== undefined && origin !== null;
}
