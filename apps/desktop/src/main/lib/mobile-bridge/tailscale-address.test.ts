import { describe, expect, it } from "bun:test";
import { findTailscaleAddress, type InterfaceMap } from "./tailscale-address";

function v4(address: string, internal = false) {
	return {
		address,
		netmask: "255.255.255.255",
		family: "IPv4" as const,
		mac: "00:00:00:00:00:00",
		internal,
		cidr: `${address}/32`,
	};
}

describe("findTailscaleAddress", () => {
	it("finds the address on a Tailscale interface", () => {
		const interfaces: InterfaceMap = {
			Ethernet: [v4("192.168.1.20")],
			Tailscale: [v4("100.127.3.124")],
		};
		expect(findTailscaleAddress(interfaces)).toEqual({
			address: "100.127.3.124",
			interfaceName: "Tailscale",
		});
	});

	it("accepts the CGNAT range when the interface has another name", () => {
		// The interface name varies by platform and install method; the range is
		// part of how Tailscale works.
		expect(findTailscaleAddress({ tun0: [v4("100.64.0.1")] })).toEqual({
			address: "100.64.0.1",
			interfaceName: "tun0",
		});
	});

	it("prefers the named interface over a bare range match", () => {
		// A machine can sit behind carrier-grade NAT on a normal adapter, which
		// lands in the same range without being a tailnet.
		const interfaces: InterfaceMap = {
			wwan0: [v4("100.100.5.5")],
			Tailscale: [v4("100.101.1.1")],
		};
		expect(findTailscaleAddress(interfaces)?.interfaceName).toBe("Tailscale");
	});

	it("returns nothing when Tailscale is not connected", () => {
		// The caller must then REFUSE to start rather than widen the bind.
		const interfaces: InterfaceMap = {
			Ethernet: [v4("192.168.1.20")],
			"Loopback Pseudo-Interface 1": [v4("127.0.0.1", true)],
		};
		expect(findTailscaleAddress(interfaces)).toBeNull();
	});

	it("rejects addresses just outside the CGNAT range", () => {
		// 100.63.x and 100.128.x are ordinary public space — binding there would
		// be the mistake this function exists to prevent.
		expect(findTailscaleAddress({ eth0: [v4("100.63.255.255")] })).toBeNull();
		expect(findTailscaleAddress({ eth0: [v4("100.128.0.1")] })).toBeNull();
	});

	it("ignores loopback and non-IPv4 entries", () => {
		const interfaces: InterfaceMap = {
			Tailscale: [
				{ ...v4("100.70.0.1", true) },
				{
					address: "fd7a:115c:a1e0::1",
					netmask: "ffff:ffff:ffff:ffff::",
					family: "IPv6" as const,
					mac: "00:00:00:00:00:00",
					internal: false,
					cidr: "fd7a:115c:a1e0::1/64",
					scopeid: 0,
				},
			],
		};
		expect(findTailscaleAddress(interfaces)).toBeNull();
	});

	it("survives an empty or sparse interface map", () => {
		expect(findTailscaleAddress({})).toBeNull();
		expect(findTailscaleAddress({ eth0: undefined })).toBeNull();
	});
});
