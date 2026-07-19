import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function read(path: string): Promise<string> {
	return Bun.file(resolve(root, path)).text();
}

describe("GatedSpace local integration routing", () => {
	test("desktop stack launches the web app", async () => {
		const pkg = JSON.parse(await read("package.json")) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts["dev:desktop"]).toContain("--filter=@superset/web");
	});

	test("web UI avoids the AIOS port", async () => {
		const env = await read(".env.local.example");
		expect(env).toContain("NEXT_PUBLIC_WEB_URL=http://localhost:3018");
		const setup = await read(".superset/setup.local.sh");
		expect(setup).toContain("local WEB_PORT=$((BASE + 18))");
	});

	test("GitHub app and callbacks are fork-configurable", async () => {
		const installRoute = await read(
			"apps/api/src/app/api/github/install/route.ts",
		);
		expect(installRoute).toContain("env.GH_APP_SLUG");
		expect(installRoute).toContain(
			'integrationsPublicUrl("/api/github/callback")',
		);
		expect(installRoute).not.toContain("github.com/apps/superset-app");
	});

	test("Slack manifest is branded and public-URL driven", async () => {
		const manifest = await read(
			"apps/api/src/app/api/integrations/slack/manifest.json",
		);
		expect(manifest).toContain('"name": "GatedSpace"');
		expect(manifest).toContain("{{INTEGRATIONS_PUBLIC_API_URL}}");
		expect(manifest).not.toContain("api.superset.sh");
	});

	test("integration jobs do not target the browser-only local API URL", async () => {
		const routes = [
			"apps/api/src/app/api/github/jobs/initial-sync/route.ts",
			"apps/api/src/app/api/integrations/linear/jobs/initial-sync/route.ts",
			"apps/api/src/app/api/integrations/linear/jobs/sync-task/route.ts",
			"apps/api/src/app/api/integrations/slack/jobs/process-mention/route.ts",
			"apps/api/src/app/api/integrations/slack/jobs/process-assistant-message/route.ts",
		];
		for (const route of routes) {
			const source = await read(route);
			expect(source).toContain("integrationsPublicUrl");
			expect(source).not.toContain("env.NEXT_PUBLIC_API_URL");
		}
	});
});
