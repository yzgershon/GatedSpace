/** Produce an isolated upload tree: no local profiles, environment files or transcripts. */
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const temporary = path.join(root, ".tmp");
mkdirSync(temporary, { recursive: true });
const destination = mkdtempSync(
	path.join(temporary, "gatedspace-sync-deploy-"),
);
const files = [];
function copy(relative) {
	const from = path.join(root, relative);
	const to = path.join(destination, relative);
	mkdirSync(path.dirname(to), { recursive: true });
	cpSync(from, to);
	files.push({
		path: relative,
		sha256: createHash("sha256").update(readFileSync(from)).digest("hex"),
	});
}
function sourceTree(relative) {
	for (const entry of readdirSync(path.join(root, relative), {
		withFileTypes: true,
	})) {
		const child = `${relative}/${entry.name}`;
		if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${child}`);
		if (entry.isDirectory()) sourceTree(child);
		else if (
			/\.(ts|tsx|css)$/.test(entry.name) &&
			!/\.(test|spec)\./.test(entry.name)
		)
			copy(child);
	}
}
function json(relative, value) {
	const to = path.join(destination, relative);
	mkdirSync(path.dirname(to), { recursive: true });
	writeFileSync(to, `${JSON.stringify(value, null, 2)}\n`);
}
sourceTree("apps/sync/src");
sourceTree("packages/shared/src/continuity");
copy("packages/db/src/schema/continuity.ts");
for (const file of [
	"package.json",
	"tsconfig.json",
	"next.config.ts",
	"next-env.d.ts",
]) {
	if (existsSync(path.join(root, "apps/sync", file))) copy(`apps/sync/${file}`);
}
for (const file of ["base.json", "next.json", "package.json"])
	copy(`tooling/typescript/${file}`);
json("package.json", {
	name: "gatedspace-sync-deployment",
	private: true,
	packageManager: "bun@1.3.14",
	workspaces: ["apps/*", "packages/*", "tooling/*"],
});
json("packages/shared/package.json", {
	name: "@superset/shared",
	version: "0.0.0",
	private: true,
	type: "module",
	exports: {
		"./continuity": "./src/continuity/protocol.ts",
		"./continuity/crypto": "./src/continuity/crypto.ts",
		"./continuity/client": "./src/continuity/client.ts",
		"./continuity/device-sign-in": "./src/continuity/device-sign-in.ts",
	},
	dependencies: { zod: "4.3.6" },
});
json("packages/db/package.json", {
	name: "@superset/db",
	version: "0.0.0",
	private: true,
	type: "module",
	exports: { "./schema/continuity": "./src/schema/continuity.ts" },
	dependencies: { "drizzle-orm": "0.45.2", "@superset/shared": "workspace:*" },
});
writeFileSync(
	path.join(destination, ".vercelignore"),
	"**/node_modules\n**/.next\n**/.cache\n**/.env*\n**/*.log\n",
);
writeFileSync(
	path.join(temporary, "gatedspace-sync-deploy-current.json"),
	JSON.stringify({ destination, files }, null, 2),
);
console.log(JSON.stringify({ destination, sourceFiles: files.length }));
