import { createHash, randomUUID } from "node:crypto";
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
	isLocalPreviewUrl,
	LOCAL_PREVIEW_SCHEME,
	loopbackPreviewUrl,
} from "../../../shared/local-preview";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
};
const manifestSchema = z.object({
	directory: z.string(),
	revision: z.string().uuid(),
	digest: z.string(),
	origins: z.array(z.string()).max(64),
	files: z.array(z.string()).max(5000),
});
type Manifest = z.infer<typeof manifestSchema>;

function contained(root: string, path: string) {
	const part = relative(root, path);
	return (
		part === "" ||
		(!part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part))
	);
}

/** Copies only explicitly selected static output. No subprocesses, polling or live-app API caching. */
export class LocalPreviewStore {
	private queue: Promise<unknown> = Promise.resolve();
	constructor(private readonly root: string) {}
	private async manifest(id: string): Promise<Manifest | null> {
		if (!/^[a-f0-9]{32}$/.test(id)) return null;
		try {
			const file = join(this.root, id, "manifest.json");
			if ((await stat(file)).size > 1_000_000) return null;
			return manifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
		} catch {
			return null;
		}
	}

	async capture(directory: string, workspace: string, originalUrl?: string) {
		const task = this.queue.then(() =>
			this.captureNow(directory, workspace, originalUrl),
		);
		this.queue = task.catch(() => {});
		return task;
	}
	private async captureNow(
		directory: string,
		workspace: string,
		originalUrl?: string,
	) {
		const source = await realpath(resolve(workspace, directory));
		const boundary = await realpath(workspace);
		if (
			!contained(boundary, source) ||
			source === boundary ||
			contained(source, resolve(this.root))
		)
			throw new Error(
				"Select a generated preview folder inside this workspace, not the project root.",
			);
		const original = originalUrl ? loopbackPreviewUrl(originalUrl) : null;
		if (originalUrl && !original)
			throw new Error("A saved preview can only replace a loopback URL.");
		const files: string[] = [];
		let bytes = 0;
		let entries = 0;
		const digest = createHash("sha256");
		const visit = async (folder: string, depth = 0) => {
			if (depth > 32)
				throw new Error(
					"Preview folders are too deeply nested. Select bundled output.",
				);
			for (const entry of (await readdir(folder, { withFileTypes: true })).sort(
				(a, b) => a.name.localeCompare(b.name),
			)) {
				if (++entries > 10_000)
					throw new Error(
						"Preview has too many entries. Select bundled output.",
					);
				if (
					entry.name.startsWith(".") ||
					entry.name === "node_modules" ||
					entry.isSymbolicLink()
				)
					continue;
				const file = join(folder, entry.name);
				if (entry.isDirectory()) {
					await visit(file, depth + 1);
					continue;
				}
				if (!entry.isFile() || !TYPES[extname(file).toLowerCase()]) continue;
				const info = await stat(file);
				bytes += info.size;
				if (bytes > 64 * 1024 * 1024 || files.length >= 5000)
					throw new Error(
						"Preview is too large. Select its bundled output folder (up to 64 MB).",
					);
				const name = relative(source, file).split(sep).join("/");
				files.push(name);
				digest
					.update(name)
					.update("\0")
					.update(await readFile(file));
			}
		};
		await visit(source);
		if (!files.includes("index.html"))
			throw new Error("The preview folder must contain index.html.");
		const id = createHash("sha256").update(source).digest("hex").slice(0, 32);
		const previous = await this.manifest(id);
		const hash = digest.digest("hex");
		const revision =
			previous?.digest === hash ? previous.revision : randomUUID();
		const base = join(this.root, id);
		const target = join(base, revision);
		await mkdir(base, { recursive: true });
		if (revision !== previous?.revision) {
			try {
				for (const file of files) {
					const src = join(source, file);
					if (
						(await lstat(src)).isSymbolicLink() ||
						!contained(source, await realpath(src))
					)
						throw new Error("Preview source moved outside its folder.");
					const dest = join(target, file);
					await mkdir(resolve(dest, ".."), { recursive: true });
					await copyFile(src, dest);
				}
			} catch (error) {
				if (contained(base, target))
					await rm(target, { recursive: true, force: true });
				throw error;
			}
		}
		const origins = [
			...new Set([
				...(previous?.origins ?? []),
				...(original ? [original.origin] : []),
			]),
		].slice(-64);
		const manifest: Manifest = {
			directory: source,
			revision,
			digest: hash,
			origins,
			files,
		};
		const temp = join(base, `${randomUUID()}.tmp`);
		await writeFile(temp, JSON.stringify(manifest));
		await rename(temp, join(base, "manifest.json"));
		if (previous && previous.revision !== revision) {
			const obsolete = resolve(base, previous.revision);
			if (contained(resolve(base), obsolete))
				await rm(obsolete, { recursive: true, force: true });
		}
		return {
			url: `${LOCAL_PREVIEW_SCHEME}://${id}${original?.pathname ?? "/"}${original?.search ?? ""}${original?.hash ?? ""}`,
			updated: previous?.digest !== hash,
		};
	}

	/** Upgrade a previously saved localhost URL, retaining its route/query/fragment. */
	async resolveUrl(value: string, workspaces: string[] = []): Promise<string> {
		if (isLocalPreviewUrl(value)) return value;
		const url = loopbackPreviewUrl(value);
		if (!url) return value;
		const matches: string[] = [];
		for (const entry of await readdir(this.root).catch(() => [] as string[])) {
			const saved = await this.manifest(entry);
			if (saved?.origins.includes(url.origin)) matches.push(entry);
		}
		if (matches.length === 1)
			return `${LOCAL_PREVIEW_SCHEME}://${matches[0]}${url.pathname}${url.search}${url.hash}`;
		if (matches.length > 1) return value;
		const candidates: Array<{ directory: string; workspace: string }> = [];
		for (const workspace of [...new Set(workspaces)]) {
			// Legacy generated previews wrote their exact URL into .tmp/*preview/url.txt.
			// Inspect only those small manifests, never arbitrary project contents or private staging.
			const roots = [workspace];
			for (const entry of (
				await readdir(workspace, { withFileTypes: true }).catch(() => [])
			)
				.filter(
					(entry) =>
						entry.isDirectory() &&
						!entry.isSymbolicLink() &&
						!entry.name.startsWith(".") &&
						entry.name !== "node_modules",
				)
				.slice(0, 100)) {
				roots.push(join(workspace, entry.name));
			}
			for (const root of roots) {
				for (const entry of (
					await readdir(join(root, ".tmp"), { withFileTypes: true }).catch(
						() => [],
					)
				)
					.filter(
						(entry) =>
							entry.isDirectory() &&
							!entry.isSymbolicLink() &&
							/preview$/i.test(entry.name),
					)
					.slice(0, 200)) {
					const directory = join(root, ".tmp", entry.name);
					for (const name of ["url.txt", "check-url.txt"]) {
						try {
							const file = join(directory, name);
							if ((await stat(file)).size > 2048) continue;
							if (
								loopbackPreviewUrl((await readFile(file, "utf8")).trim())
									?.origin === url.origin &&
								!candidates.some((c) => c.directory === directory)
							)
								candidates.push({ directory, workspace });
						} catch {
							/* Not a legacy preview manifest. */
						}
					}
				}
			}
		}
		return candidates.length === 1
			? (
					await this.capture(
						candidates[0].directory,
						candidates[0].workspace,
						value,
					)
				).url
			: value;
	}

	async respond(request: Request): Promise<Response> {
		if (!isLocalPreviewUrl(request.url))
			return new Response("Not found", { status: 404 });
		if (!["GET", "HEAD"].includes(request.method))
			return new Response("Static previews do not provide a backend.", {
				status: 405,
			});
		try {
			const url = new URL(request.url);
			const saved = await this.manifest(url.hostname);
			if (!saved)
				return new Response(
					"Saved preview not found. Ask the agent to reopen its output folder.",
					{ status: 404 },
				);
			const name =
				decodeURIComponent(url.pathname).replace(/^\//, "") || "index.html";
			if (
				name
					.split(/[\\/]/)
					.some((part) => part === ".." || part.startsWith(".")) ||
				name.includes(":")
			)
				return new Response("Not found", { status: 404 });
			const file = saved.files.includes(name)
				? name
				: !extname(name)
					? "index.html"
					: "";
			if (!file) return new Response("Not found", { status: 404 });
			const base = join(this.root, url.hostname, saved.revision);
			const location = await realpath(join(base, file));
			if (!contained(base, location))
				return new Response("Not found", { status: 404 });
			return new Response(
				request.method === "HEAD"
					? null
					: new Uint8Array(await readFile(location)),
				{
					headers: {
						"Content-Type":
							TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
						"Cache-Control": "no-store",
						"X-Content-Type-Options": "nosniff",
					},
				},
			);
		} catch {
			return new Response("Preview file unavailable", { status: 404 });
		}
	}
}
