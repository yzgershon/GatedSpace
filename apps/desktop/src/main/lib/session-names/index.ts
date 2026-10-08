import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SUPERSET_HOME_DIR } from "../app-environment";
import {
	getSessionTitleOverride,
	setSessionTitleOverride,
} from "../claude-sessions/session-titles";
import { writeSecureFile } from "../secure-file";
import { SessionNameStore } from "./store";

const file = join(SUPERSET_HOME_DIR, "session-names.json");
const schema = z.object({
	names: z.record(
		z.string(),
		z.object({ title: z.string(), source: z.enum(["manual", "generated"]) }),
	),
	aliases: z.record(z.string(), z.string()),
});
export const sessionNames = new SessionNameStore({
	load() {
		try {
			return schema.parse(JSON.parse(readFileSync(file, "utf8")));
		} catch {
			return { names: {}, aliases: {} };
		}
	},
	save(value) {
		const temp = `${file}.${process.pid}.tmp`;
		writeSecureFile(temp, JSON.stringify(value));
		renameSync(temp, file);
	},
	legacy: getSessionTitleOverride,
	mirror: setSessionTitleOverride,
	generate: async (prompt) =>
		(await import("./generate")).generateSessionName(prompt),
});
export function sessionNamingInstructions(key: string) {
	return `For a NEW session, after reading the first real user request, call gatedspace_browser.name_session with session=${JSON.stringify(key)} and a concise 3-7 word title describing the task and subject (max 56 characters). Infer its purpose; do not copy the first prompt. Do this once, then continue the task. The tool protects existing and manually renamed sessions; if it reports unchanged, do not retry. Never rename a resumed conversation automatically.`;
}
