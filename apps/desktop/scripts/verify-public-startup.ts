/** Run only on an ephemeral CI runner, against the actual packaged executable. */
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureInitialGitCommit } from "../../../packages/shared/src/initial-git-commit";

if (process.env.GITHUB_ACTIONS !== "true")
	throw new Error(
		"Packaged startup smoke test requires an ephemeral GitHub runner",
	);
const arch = process.env.TARGET_ARCH ?? process.arch;
const unpacked = resolve(
	"release",
	arch === "arm64" ? "win-arm64-unpacked" : "win-unpacked",
);
const exe = join(unpacked, "GatedSpace.exe");
const git = join(unpacked, "resources/resources/git/cmd/git.exe");
if (!existsSync(exe) || !existsSync(git))
	throw new Error("Packaged app or private Git missing");
const root = mkdtempSync(join(tmpdir(), "gatedspace-public-smoke-"));
const home = join(root, "app-home");
const project = join(root, "Friend project");
mkdirSync(project, { recursive: true });
const env: NodeJS.ProcessEnv = {
	...process.env,
	USERPROFILE: root,
	HOME: root,
	SUPERSET_HOME_DIR: home,
	APPDATA: join(root, "Roaming"),
	LOCALAPPDATA: join(root, "Local"),
	PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`,
	GIT_CONFIG_GLOBAL: join(root, "empty.gitconfig"),
	GIT_CONFIG_NOSYSTEM: "1",
};
env.Path = env.PATH;
for (const key of [
	"ELECTRON_RUN_AS_NODE",
	"NoDefaultCurrentDirectoryInExePath",
	"GIT_AUTHOR_NAME",
	"GIT_AUTHOR_EMAIL",
	"GIT_COMMITTER_NAME",
	"GIT_COMMITTER_EMAIL",
])
	delete env[key];
writeFileSync(env.GIT_CONFIG_GLOBAL ?? "", "");
const raw = async (args: string[]) => {
	const result = spawnSync(git, args, {
		cwd: project,
		env,
		encoding: "utf8",
		windowsHide: true,
	});
	if (result.status !== 0)
		throw new Error(
			result.stderr || result.error?.message || "Private Git failed",
		);
	return result.stdout;
};
await raw(["--version"]);
await raw(["init", "-b", "main"]);
writeFileSync(join(project, "keep.txt"), "existing work");
await raw(["add", "keep.txt"]);
await ensureInitialGitCommit({ raw });
if ((await raw(["ls-tree", "--name-only", "HEAD"])).trim())
	throw new Error("Initial checkpoint committed existing files");
if (!(await raw(["diff", "--cached", "--name-only"])).includes("keep.txt"))
	throw new Error("Initial checkpoint changed staged work");
console.log(
	"PASS private Git without system Git or configured identity; staged files preserved",
);

const port = 19000 + Math.floor(Math.random() * 10000);
const child = spawn(
	exe,
	[
		`--remote-debugging-port=${port}`,
		"--remote-debugging-address=127.0.0.1",
		`--user-data-dir=${join(root, "chromium")}`,
	],
	{ env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
child.stdout?.on("data", (data) => {
	log += data.toString();
});
child.stderr?.on("data", (data) => {
	log += data.toString();
});
let socket: WebSocket | undefined;
try {
	let target: { webSocketDebuggerUrl: string } | undefined;
	for (let i = 0; i < 120; i++) {
		if (child.exitCode !== null)
			throw new Error(`Packaged app exited during startup (${child.exitCode})`);
		try {
			const tabs = (await (
				await fetch(`http://127.0.0.1:${port}/json`, {
					signal: AbortSignal.timeout(1000),
				})
			).json()) as { type: string; webSocketDebuggerUrl: string }[];
			target = tabs.find((tab) => tab.type === "page");
		} catch {
			/* Wait for Chromium. */
		}
		if (target) break;
		await Bun.sleep(1000);
	}
	if (!target) throw new Error("Packaged renderer did not start");
	socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((ok, fail) => {
		socket?.addEventListener("open", () => ok(), { once: true });
		socket?.addEventListener(
			"error",
			() => fail(new Error("CDP connection failed")),
			{ once: true },
		);
	});
	let id = 0;
	const evaluate = (expression: string) =>
		new Promise<unknown>((ok, fail) => {
			const request = ++id;
			const timer = setTimeout(() => {
				socket?.removeEventListener("message", listener);
				fail(new Error("Renderer evaluation timed out"));
			}, 10000);
			const listener = (event: MessageEvent) => {
				const reply = JSON.parse(String(event.data));
				if (reply.id !== request) return;
				clearTimeout(timer);
				socket?.removeEventListener("message", listener);
				if (reply.error || reply.result?.exceptionDetails)
					fail(new Error("Renderer evaluation failed"));
				else ok(reply.result?.result?.value);
			};
			socket?.addEventListener("message", listener);
			socket?.send(
				JSON.stringify({
					id: request,
					method: "Runtime.evaluate",
					params: { expression, returnByValue: true, awaitPromise: true },
				}),
			);
		});
	const ready = async () => {
		let lastText = "";
		for (let i = 0; i < 120; i++) {
			if (child.exitCode !== null)
				throw new Error("App closed during clean-profile check");
			const text = String(await evaluate("document.body?.innerText ?? ''"));
			lastText = text;
			if (text.includes("Your space to build") && text.includes("Open folder"))
				return;
			await Bun.sleep(1000);
		}
		writeFileSync(
			resolve(`release/public-smoke-${arch}-screen.json`),
			JSON.stringify(
				{ url: await evaluate("location.href"), text: lastText },
				null,
				2,
			),
		);
		throw new Error("Clean profile did not reach public setup");
	};
	await ready();
	console.log(
		"PASS clean profile reaches setup with no GatedSpace/cloud sign-in",
	);
	const manifestFile = join(
		home,
		"host/00000000-0000-4000-8000-000000000002/manifest.json",
	);
	for (let i = 0; i < 80 && !existsSync(manifestFile); i++)
		await Bun.sleep(250);
	if (!existsSync(manifestFile)) throw new Error("Local backend did not start");
	const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
	const plain = join(root, "Plain folder");
	mkdirSync(plain);
	writeFileSync(join(plain, "notes.txt"), "untouched");
	const response = await fetch(`${manifest.endpoint}/trpc/project.create`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${manifest.authToken}`,
		},
		body: JSON.stringify({
			json: {
				name: "Friend project",
				mode: { kind: "importLocal", repoPath: plain, initIfNeeded: true },
			},
		}),
	});
	const result = (await response.json()) as {
		result?: { data?: { json?: { mainWorkspaceId?: string } } };
		error?: unknown;
	};
	if (!response.ok || !result.result?.data?.json?.mainWorkspaceId)
		throw new Error(`Local folder import failed: ${JSON.stringify(result)}`);
	if (readFileSync(join(plain, "notes.txt"), "utf8") !== "untouched")
		throw new Error("Folder contents changed");
	console.log(
		"PASS packaged backend opens a plain folder and creates its workspace",
	);
	await evaluate(
		"localStorage.setItem('gatedspace:auth-mode','cloud'); location.hash='/workspaces'; true",
	);
	await evaluate("setTimeout(()=>location.reload(),50); true");
	await Bun.sleep(1500);
	await ready();
	console.log(
		"PASS old cloud preference cannot strand public installs at sign-in",
	);
	writeFileSync(
		resolve(`release/public-smoke-${arch}.json`),
		JSON.stringify(
			{
				arch,
				passed: true,
				checks: [
					"private-git",
					"clean-profile",
					"local-backend",
					"plain-folder",
					"legacy-cloud-preference",
				],
			},
			null,
			2,
		),
	);
} finally {
	socket?.close();
	if (child.pid && child.exitCode === null)
		spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
			windowsHide: true,
			stdio: "ignore",
		});
	writeFileSync(resolve(`release/public-smoke-${arch}.log`), log);
}
