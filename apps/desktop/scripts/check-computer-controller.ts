/** Protocol readiness only: does not call screenshot/input tools or move focus. */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { WindowsComputerBackend } from "../src/main/lib/computer-use/backend";

const backend = new WindowsComputerBackend();
let owned: number[] = [];
try {
	const tools = await backend.start(new AbortController().signal);
	const root = backend.processId;
	if (!root) throw new Error("Controller process is missing");
	const rows = JSON.parse(
		execFileSync(
			join(
				process.env.SystemRoot || "C:\\Windows",
				"System32",
				"WindowsPowerShell",
				"v1.0",
				"powershell.exe",
			),
			[
				"-NoProfile",
				"-Command",
				"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
			],
			{ encoding: "utf8", windowsHide: true },
		),
	) as { ProcessId: number; ParentProcessId: number }[];
	owned = [root];
	for (let index = 0; index < owned.length; index++)
		for (const row of rows)
			if (
				row.ParentProcessId === owned[index] &&
				!owned.includes(row.ProcessId)
			)
				owned.push(row.ProcessId);
	console.log(
		JSON.stringify({
			connected: true,
			tools: tools.map((tool) => tool.name),
			desktopActions: 0,
		}),
	);
} finally {
	await backend.close();
}
for (const pid of owned) {
	let alive = false;
	try {
		process.kill(pid, 0);
		alive = true;
	} catch {
		/* Gone. */
	}
	if (alive) throw new Error(`Controller process ${pid} survived Stop`);
}
console.log(JSON.stringify({ stopped: true, checkedProcesses: owned.length }));
