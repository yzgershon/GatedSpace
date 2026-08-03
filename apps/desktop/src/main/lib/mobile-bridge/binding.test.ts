import { describe, expect, it } from "bun:test";
import {
	DEFAULT_BRIDGE_BINDING_MODE,
	type InterfaceMap,
	isBridgeBindingMode,
	resolveBinding,
} from "./binding";

function v4(address: string, internal = false) {
	return {
		address,
		netmask: "255.255.255.0",
		family: "IPv4" as const,
		mac: "00:00:00:00:00:00",
		internal,
		cidr: `${address}/24`,
	};
}

const TYPICAL: InterfaceMap = {
	"Wi-Fi": [v4("192.168.1.42")],
	Tailscale: [v4("100.127.3.124")],
	"vEthernet (WSL)": [v4("172.28.0.1")],
	"Loopback Pseudo-Interface 1": [v4("127.0.0.1", true)],
};

describe("resolveBinding", () => {
	it("defaults to tailnet-only, never to LAN", () => {
		// The bridge can type into a live agent session, so a default that
		// binds 0.0.0.0 over plain HTTP publishes that to every network the
		// machine joins. Must stay in step with BRIDGE_DEFAULT_STATE.mode.
		expect(DEFAULT_BRIDGE_BINDING_MODE).toBe("tailscale-serve");
		expect(DEFAULT_BRIDGE_BINDING_MODE).not.toBe("lan");
	});

	it("LAN binds every interface but SHOWS a routable address", () => {
		// 0.0.0.0 is not something anyone can type into a phone, so the bind
		// address and the link address are necessarily different.
		expect(resolveBinding("lan", TYPICAL)).toEqual({
			bindAddress: "0.0.0.0",
			displayAddress: "192.168.1.42",
		});
	});

	it("LAN ignores virtual adapters", () => {
		// WSL and Docker answer on subnets no phone is on; picking one would
		// produce a link that silently never connects.
		const result = resolveBinding("lan", {
			"vEthernet (WSL)": [v4("172.28.0.1")],
			"Docker Desktop": [v4("10.99.0.1")],
			Ethernet: [v4("192.168.0.7")],
		});
		expect(result).toMatchObject({ displayAddress: "192.168.0.7" });
	});

	it("LAN does not fall back to the Tailscale address", () => {
		// Otherwise the two modes would be silently identical on this machine,
		// and 'LAN' would not mean what it says.
		const result = resolveBinding("lan", {
			Tailscale: [v4("100.127.3.124")],
		});
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("Tailscale binds the tailnet address specifically", () => {
		// Not 0.0.0.0: choosing Tailscale should CLOSE the local network, not
		// merely add another way in.
		expect(resolveBinding("tailscale", TYPICAL)).toEqual({
			bindAddress: "100.127.3.124",
			displayAddress: "100.127.3.124",
		});
	});

	it("Tailscale refuses rather than widening when there is no tailnet", () => {
		const result = resolveBinding("tailscale", {
			"Wi-Fi": [v4("192.168.1.42")],
		});
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("loopback stays on this machine", () => {
		expect(resolveBinding("loopback", TYPICAL)).toEqual({
			bindAddress: "127.0.0.1",
			displayAddress: "127.0.0.1",
		});
	});

	it("LAN says so when there is no network at all", () => {
		expect(resolveBinding("lan", {})).toEqual({ error: expect.any(String) });
	});
});

describe("isBridgeBindingMode", () => {
	it("accepts the three modes and nothing else", () => {
		// The value round-trips through a settings column, so an old or hand-edited
		// row must not become an unrecognised bind target.
		expect(isBridgeBindingMode("lan")).toBe(true);
		expect(isBridgeBindingMode("tailscale")).toBe(true);
		expect(isBridgeBindingMode("loopback")).toBe(true);
		expect(isBridgeBindingMode("0.0.0.0")).toBe(false);
		expect(isBridgeBindingMode(undefined)).toBe(false);
		expect(isBridgeBindingMode(null)).toBe(false);
	});
});
