/**
 * Where the mobile bridge listens, and what address to hand the phone.
 *
 * Two different addresses, which is the subtlety here. LAN mode BINDS to
 * 0.0.0.0 — every interface — but 0.0.0.0 is not something you can type into a
 * phone. The link has to carry a real routable address, so the bind address and
 * the display address are resolved separately.
 *
 * Pure over the interface list so the whole decision is testable; this is the
 * part that decides who can reach an endpoint that drives an agent.
 */
import type { NetworkInterfaceInfo } from "node:os";
import {
	findTailscaleAddress,
	NO_TAILSCALE_MESSAGE,
} from "./tailscale-address";

export type BridgeBindingMode =
	| "lan"
	| "tailscale"
	| "tailscale-serve"
	| "loopback";

export const BRIDGE_BINDING_MODES: BridgeBindingMode[] = [
	"lan",
	"tailscale",
	"tailscale-serve",
	"loopback",
];

/**
 * Matches BRIDGE_DEFAULT_STATE.mode. Both fallbacks used to say "lan", which
 * binds 0.0.0.0 over plain HTTP — so any path that reached a default rather
 * than the persisted state published an agent that runs shell commands to
 * every network the machine was on. `tailscale-serve` is tailnet-only, and on
 * a machine without Tailscale it fails to start rather than falling back to
 * something broader.
 */
export const DEFAULT_BRIDGE_BINDING_MODE: BridgeBindingMode = "tailscale-serve";

export function isBridgeBindingMode(
	value: unknown,
): value is BridgeBindingMode {
	return (
		typeof value === "string" &&
		(BRIDGE_BINDING_MODES as string[]).includes(value)
	);
}

export type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface BindingPlan {
	/** Passed to `listen()`. */
	bindAddress: string;
	/** Put in the link. Must be reachable from the phone. */
	displayAddress: string;
}

export type BindingResolution = BindingPlan | { error: string };

/**
 * Private-range IPv4, in the order a home or school network is likely to use.
 * A machine can have several — Wi-Fi, Ethernet, Docker, WSL, Hyper-V — and the
 * virtual ones are not reachable from a phone, so ordering matters more than
 * simply taking the first non-internal address.
 */
function lanCandidates(interfaces: InterfaceMap): string[] {
	const preferred: string[] = [];
	const other: string[] = [];

	for (const [name, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			// Virtual adapters answer on their own subnets that no phone is on.
			// Excluding them by name is crude but it is what distinguishes them.
			const virtual =
				/docker|vethernet|wsl|hyper-v|vmware|virtualbox|loopback/i;
			if (virtual.test(name)) continue;
			// Tailscale is reachable, but not what "LAN" means — and picking it here
			// would make the two modes silently identical on a machine with it.
			if (/tailscale/i.test(name)) continue;

			if (isPrivateV4(entry.address)) preferred.push(entry.address);
			else other.push(entry.address);
		}
	}

	return [...preferred, ...other];
}

function isPrivateV4(address: string): boolean {
	const parts = address.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
		return false;
	}
	const [a, b] = parts as [number, number, number, number];
	if (a === 10) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	return false;
}

export const NO_LAN_MESSAGE =
	"No network connection found. Connect to Wi-Fi or Ethernet, or switch the " +
	"binding mode.";

export function resolveBinding(
	mode: BridgeBindingMode,
	interfaces: InterfaceMap,
): BindingResolution {
	if (mode === "loopback" || mode === "tailscale-serve") {
		// Loopback for both. Plain `loopback` is the base for a tunnel you run
		// yourself; `tailscale-serve` is the same thing with Tailscale as the
		// tunnel, terminating TLS in front of it. The caller replaces the display
		// address with the tailnet DNS name once serve is up, because that name
		// is what the certificate is issued for.
		return { bindAddress: "127.0.0.1", displayAddress: "127.0.0.1" };
	}

	if (mode === "tailscale") {
		const found = findTailscaleAddress(interfaces);
		if (!found) return { error: NO_TAILSCALE_MESSAGE };
		// Bind the tailnet address specifically, so the port is not open on the
		// local network at the same time.
		return { bindAddress: found.address, displayAddress: found.address };
	}

	const candidates = lanCandidates(interfaces);
	if (candidates.length === 0) return { error: NO_LAN_MESSAGE };
	// Bind every interface — the phone may arrive over Wi-Fi while the machine
	// also has Ethernet — but SHOW a routable address, since 0.0.0.0 cannot be
	// typed into a phone.
	return { bindAddress: "0.0.0.0", displayAddress: candidates[0] as string };
}
