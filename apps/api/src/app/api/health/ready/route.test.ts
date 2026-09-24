import { expect, mock, test } from "bun:test";

let unavailable = false;
mock.module("@superset/db/client", () => ({
	db: {
		execute: async () => {
			if (unavailable) throw new Error("private database detail");
			return [{ ready: 1 }];
		},
	},
}));
const { GET } = await import("./route");
test("readiness requires a successful database query and is never cached", async () => {
	const response = await GET();
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(await response.json()).toEqual({ ready: true });
});
test("database failure is unavailable even though the API process is alive", async () => {
	unavailable = true;
	const response = await GET();
	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({ ready: false });
});
