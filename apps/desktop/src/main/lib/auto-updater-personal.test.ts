import { expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

for (const channel of ["personal", "public"]) {
	it(`routes ${channel} updates in an isolated main-process fixture`, async () => {
		const { stderr } = await promisify(execFile)(
			process.execPath,
			["test", join(import.meta.dir, "auto-updater-routing.fixture.ts")],
			{
				windowsHide: true,
				timeout: 15_000,
				env: { ...process.env, GS_UPDATE_TEST_CHANNEL: channel },
			},
		);
		expect(stderr).toContain("0 fail");
	}, 20_000);
}
