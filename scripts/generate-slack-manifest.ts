import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(import.meta.dir, "../.env") });

const publicApiUrl = process.env.INTEGRATIONS_PUBLIC_API_URL?.replace(
	/\/$/,
	"",
);
if (!publicApiUrl || new URL(publicApiUrl).protocol !== "https:") {
	throw new Error(
		"INTEGRATIONS_PUBLIC_API_URL must be set to the stable public HTTPS API origin",
	);
}

const templatePath = resolve(
	import.meta.dir,
	"../apps/api/src/app/api/integrations/slack/manifest.json",
);
const template = await Bun.file(templatePath).text();
const manifest = template.replaceAll(
	"{{INTEGRATIONS_PUBLIC_API_URL}}",
	publicApiUrl,
);

JSON.parse(manifest);
process.stdout.write(`${manifest}\n`);
