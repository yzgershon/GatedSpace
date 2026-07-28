/**
 * Real HTTPS for the phone bridge, via Tailscale's own TLS termination.
 *
 * This exists for two reasons, and the second is the one that made it worth
 * building:
 *
 *  1. In-page voice needs a SECURE CONTEXT. Browsers refuse microphone access
 *     over `http://192.168.x.x`, so the mic button can never appear on the
 *     default LAN link no matter what we do in the page.
 *  2. On plain HTTP the bearer token crosses the network in cleartext, in the
 *     request line of every call. On a home network that is a small risk; on
 *     school or café Wi-Fi it means anyone running a capture can lift a
 *     credential that drives an agent with a shell.
 *
 * Tailscale terminates TLS with a real Let's Encrypt certificate for the
 * machine's `*.ts.net` name, so there is no self-signed warning to train
 * yourself to click through, and no certificate for us to generate or store.
 *
 * It requires HTTPS to be enabled once in the tailnet admin console. That is a
 * genuine decision rather than a checkbox: enabling it publishes machine names
 * to public Certificate Transparency logs. The error path below says so rather
 * than reporting a bare failure.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Electron does not always inherit a shell PATH, and on Windows Tailscale
 * installs outside it by default. Bare name first so a custom install still
 * wins.
 */
const TAILSCALE_CANDIDATES = [
	"tailscale",
	"C:\\Program Files\\Tailscale\\tailscale.exe",
	"/usr/bin/tailscale",
	"/usr/local/bin/tailscale",
	"/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

/** The port Tailscale listens on for the tailnet. 443 is its HTTPS default. */
export const TAILSCALE_SERVE_PORT = 443;

export const TAILSCALE_MISSING_MESSAGE =
	"Tailscale isn't installed, or this app can't find it.";

export const TAILSCALE_HTTPS_DISABLED_MESSAGE =
	"Tailscale HTTPS isn't enabled for your tailnet. Turn on HTTPS Certificates " +
	"on the DNS page of the Tailscale admin console, then try again. Note that " +
	"enabling it publishes your machine names to public certificate logs.";

/** Args that expose a local port to the tailnet over HTTPS, in the background. */
export function buildServeArgs(port: number): string[] {
	return [
		"serve",
		"--bg",
		`--https=${TAILSCALE_SERVE_PORT}`,
		// Loopback: Tailscale is the only thing that should reach the bridge
		// directly, and it proxies from the tailnet.
		`http://127.0.0.1:${port}`,
	];
}

export function buildServeOffArgs(): string[] {
	// Turns off only OUR mapping. `serve reset` would wipe any other serve
	// config on the machine, which is not ours to discard.
	return ["serve", `--https=${TAILSCALE_SERVE_PORT}`, "off"];
}

/**
 * Tailscale reports the node's name with a trailing dot (`host.tailnet.ts.net.`)
 * because it is a fully-qualified DNS name. That dot is legal in a URL but
 * looks broken in a link someone is about to read off a screen.
 */
export function normalizeDnsName(dnsName: string): string {
	return dnsName.trim().replace(/\.$/, "");
}

/**
 * Recognises the admin-console-toggle failure among general command errors.
 *
 * Matched on phrases rather than an exit code because Tailscale returns 1 for
 * everything, and this particular failure is the one with a specific fix worth
 * telling someone about. Anything unmatched falls through to the raw message,
 * so a wrong guess here costs a worse error string, never a wrong one.
 */
export function isHttpsDisabledError(output: string): boolean {
	const text = output.toLowerCase();
	return (
		text.includes("https is disabled") ||
		text.includes("https is not enabled") ||
		text.includes("https certificates") ||
		text.includes("enable https") ||
		(text.includes("cert") &&
			(text.includes("admin console") || text.includes("dns page")))
	);
}

async function tailscale(args: string[]): Promise<string> {
	let lastError: unknown;
	for (const binary of TAILSCALE_CANDIDATES) {
		try {
			const { stdout } = await run(binary, args, { timeout: 15_000 });
			return stdout;
		} catch (error) {
			const code = (error as { code?: string }).code;
			// Only keep looking when the BINARY was missing. A real command
			// failure must surface, not be retried against another path.
			if (code === "ENOENT") {
				lastError = error;
				continue;
			}
			throw error;
		}
	}
	throw lastError ?? new Error(TAILSCALE_MISSING_MESSAGE);
}

export interface ServeResult {
	url?: string;
	error?: string;
}

/** The machine's tailnet DNS name, e.g. `yishai-xps.taile80d57.ts.net`. */
export async function getTailnetDnsName(): Promise<string | null> {
	try {
		const stdout = await tailscale(["status", "--json"]);
		const parsed = JSON.parse(stdout) as { Self?: { DNSName?: string } };
		const dnsName = parsed.Self?.DNSName;
		return dnsName ? normalizeDnsName(dnsName) : null;
	} catch {
		return null;
	}
}

export async function startTailscaleServe(port: number): Promise<ServeResult> {
	const dnsName = await getTailnetDnsName();
	if (!dnsName) {
		return { error: TAILSCALE_MISSING_MESSAGE };
	}

	try {
		await tailscale(buildServeArgs(port));
	} catch (error) {
		const output = [
			(error as { stderr?: string }).stderr ?? "",
			(error as { stdout?: string }).stdout ?? "",
			error instanceof Error ? error.message : String(error),
		].join("\n");

		if ((error as { code?: string }).code === "ENOENT") {
			return { error: TAILSCALE_MISSING_MESSAGE };
		}
		if (isHttpsDisabledError(output)) {
			return { error: TAILSCALE_HTTPS_DISABLED_MESSAGE };
		}
		return {
			error: output.split("\n").find(Boolean) ?? "Tailscale serve failed.",
		};
	}

	return { url: `https://${dnsName}` };
}

/**
 * Best-effort, and deliberately silent on failure: this runs while the bridge
 * is shutting down, and a failure to tidy up must not stop the bridge from
 * reporting that it stopped.
 */
export async function stopTailscaleServe(): Promise<void> {
	try {
		await tailscale(buildServeOffArgs());
	} catch {
		// Nothing useful to do here; the mapping points at a closed port.
	}
}

/**
 * The same teardown, blocking, for app quit.
 *
 * The quit handlers cannot await: `exitImmediately` calls `app.exit(0)` on the
 * next line, which would kill the process long before an async command
 * finished, leaving Tailscale publishing a mapping to a port that no longer
 * exists. A second of blocking on the way out is the cheaper trade.
 *
 * A hard kill still leaks the mapping, which is why `startTailscaleServe` does
 * not try to detect a stale one: serving the same port again simply replaces
 * it, so the next launch heals it without special handling.
 */
export function stopTailscaleServeSync(): void {
	for (const binary of TAILSCALE_CANDIDATES) {
		try {
			execFileSync(binary, buildServeOffArgs(), {
				timeout: 5_000,
				stdio: "ignore",
			});
			return;
		} catch (error) {
			if ((error as { code?: string }).code === "ENOENT") continue;
			return;
		}
	}
}
