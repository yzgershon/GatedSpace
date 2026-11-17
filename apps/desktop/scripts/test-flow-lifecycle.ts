/** Real capture manager and child launches; cancel synchronously before any mic command. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const desktop = resolve(import.meta.dirname, "..");
const output = resolve(desktop, "../../.tmp/flow-audit/lifecycle");
mkdirSync(output, { recursive: true });
const result = await Bun.build({
	entrypoints: [resolve(desktop, "src/main/lib/flow-dictation/service.ts")],
	target: "node",
	format: "esm",
	plugins: [
		{
			name: "electron-lifecycle-fixture",
			setup(build) {
				build.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
				build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `import {EventEmitter} from 'node:events'; export const app=Object.assign(new EventEmitter(),{isPackaged:false,getAppPath:()=>globalThis.testAppPath});globalThis.testApp=app;globalThis.testAppPath=${JSON.stringify(desktop)};`,
				}));
			},
		},
	],
});
if (!result.success) throw new Error(result.logs.join("\n"));
await Bun.write(resolve(output, "service.mjs"), result.outputs[0]);
const test = `import assert from 'node:assert/strict';
import {startFlow,stopFlow,cancelFlow} from ${JSON.stringify(pathToFileURL(resolve(output, "service.mjs")).href)};
const path=globalThis.testAppPath;
globalThis.testAppPath='C:/missing-flow-fixture';
await assert.rejects(startFlow('missing'),/dictation files are missing/);
globalThis.testAppPath=path;
for(let i=0;i<3;i++) {
 const pending=startFlow('owner');
 // Only synchronous operations until cancellation: the mic is never started.
 const busy=startFlow('other'); busy.catch(()=>{});
 cancelFlow('other');
 const stillBusy=startFlow('third'); stillBusy.catch(()=>{});
 cancelFlow('owner');
 await assert.rejects(pending,/cancelled/);
 await assert.rejects(busy,/other composer/);
 await assert.rejects(stillBusy,/other composer/);
}
await assert.rejects(stopFlow('other'),/No active dictation/);
const pending=startFlow('quit'); globalThis.testApp.emit('before-quit');
await assert.rejects(pending,/cancelled/);
console.log('PASS: real capture manager handles missing assets, pane ownership, cancellation during startup, repeat starts and app quit. No microphone command was sent.');
`;
writeFileSync(resolve(output, "test.mjs"), test);
execFileSync("node", [resolve(output, "test.mjs")], {
	stdio: "inherit",
	windowsHide: true,
	timeout: 30_000,
});
