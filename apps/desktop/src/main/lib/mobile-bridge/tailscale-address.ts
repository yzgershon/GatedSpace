/**
 * Finds the Tailscale address to serve the mobile bridge on.
 *
 * This is the security boundary of the whole feature, so it is a pure function
 * over the interface list and tested directly.
 *
 * Binding to the Tailscale interface — not 0.0.0.0 — is deliberate and not
 * merely cautious. This bridge can drive an agent that runs shell commands, so
 * anything that can reach it can run code on the machine. On 0.0.0.0 the bridge
 * would be reachable by every device on whatever network the laptop is joined
 * to, which includes cafés, schools and airports. On the Tailscale interface it
 * is reachable only by devices already on the tailnet, which is an explicit,
 * revocable list. A token is still required on top of that: two locks, because
 * the failure here is someone else's shell, not someone else's screenshot.
 *
 * When there is no Tailscale interface the bridge does NOT fall back to a wider
 * bind. It refuses to start and says why. A fallback would silently turn the
 * safe design into the unsafe one on exactly the networks where that matters.
 */
import type { NetworkInterfaceInfo } from "node:os";

export type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * Tailscale hands out addresses from the CGNAT range 100.64.0.0/10, i.e.
 * 100.64.x.x through 100.127.x.x. Matching the range rather than the interface
 * NAME because that name varies by platform and install method, while the
 * range is part of how Tailscale works.
 */
function isTailscaleV4(address: string): boolean {
	const parts = address.split(".");
	if (parts.length !== 4) return false;
	const [first, second] = parts.map((part) => Number(part));
	if (first !== 100) return false;
	if (!Number.isInteger(second)) return false;
	return second >= 64 && second <= 127;
}

export interface TailscaleAddress {
	address: string;
	interfaceName: string;
}

export function findTailscaleAddress(
	interfaces: InterfaceMap,
): TailscaleAddress | null {
	// Prefer an interface that says it is Tailscale, so a machine that happens
	// to sit behind carrier-grade NAT on some other adapter cannot be mistaken
	// for a tailnet. Fall back to the range alone, since the name is not
	// guaranteed.
	const named: TailscaleAddress[] = [];
	const ranged: TailscaleAddress[] = [];

	for (const [interfaceName, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			if (!isTailscaleV4(entry.address)) continue;
			const found = { address: entry.address, interfaceName };
			if (/tailscale/i.test(interfaceName)) named.push(found);
			else ranged.push(found);
		}
	}

	return named[0] ?? ranged[0] ?? null;
}

export const NO_TAILSCALE_MESSAGE =
	"No Tailscale connection found. The mobile bridge only serves over Tailscale, " +
	"so it is reachable from your devices and not from whatever network you are on.";
