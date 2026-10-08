import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Hash actual outputs, not timestamps: interrupted or altered output is never reusable. */
export async function hashFiles(paths: string[]): Promise<string> {
	const hash = createHash("sha256");
	async function add(path: string, label: string) {
		const stat = statSync(path);
		if (stat.isDirectory()) {
			for (const name of readdirSync(path).sort())
				await add(join(path, name), `${label}/${name}`);
		} else {
			hash.update(`${label}\0${stat.size}\0`);
			for await (const chunk of createReadStream(path)) hash.update(chunk);
		}
	}
	for (const [index, path] of paths.entries()) await add(path, String(index));
	return hash.digest("hex");
}

interface Checkpoint {
	input: string;
	digest: string;
	durationMs: number;
	finishedAt: string;
}
export class BuildCheckpoints {
	private records: Record<string, Checkpoint> = {};
	readonly timings: Array<{
		step: string;
		reused: boolean;
		durationMs: number;
	}> = [];
	constructor(private path: string) {
		if (existsSync(path)) {
			try {
				this.records = JSON.parse(readFileSync(path, "utf8"));
			} catch {
				/* A damaged journal cannot justify reusing anything. */
			}
		}
	}
	async run(
		step: string,
		input: string,
		outputs: string[],
		action: () => Promise<void>,
	) {
		const previous = this.records[step];
		if (previous?.input === input && outputs.length) {
			try {
				if ((await hashFiles(outputs)) === previous.digest) {
					this.timings.push({ step, reused: true, durationMs: 0 });
					return previous.digest;
				}
			} catch {
				/* Missing output: run this step again. */
			}
		}
		delete this.records[step];
		this.save();
		const started = Date.now();
		await action();
		const digest = await hashFiles(outputs);
		const durationMs = Date.now() - started;
		this.records[step] = {
			input,
			digest,
			durationMs,
			finishedAt: new Date().toISOString(),
		};
		this.save();
		this.timings.push({ step, reused: false, durationMs });
		return digest;
	}
	private save() {
		writeFileSync(`${this.path}.tmp`, JSON.stringify(this.records, null, 2));
		renameSync(`${this.path}.tmp`, this.path);
	}
}
