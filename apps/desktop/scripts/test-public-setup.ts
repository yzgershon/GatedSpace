/** Actual setup component, isolated services; no installer or account actions. */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { build } from "vite";

const output = resolve(import.meta.dir, "../../../.tmp/public-setup-ui");
await mkdir(output, { recursive: true });
await writeFile(
	resolve(output, "entry.tsx"),
	`import ${JSON.stringify(resolve(import.meta.dir, "../src/renderer/globals.css"))};
import { createRoot } from 'react-dom/client';
import { PublicSetup } from ${JSON.stringify(resolve(import.meta.dir, "../src/renderer/components/PublicSetup/PublicSetup.tsx"))};
createRoot(document.getElementById('root')).render(<PublicSetup />);`,
);
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	resolve: {
		alias: {
			react: resolve(import.meta.dir, "../node_modules/react"),
			"react-dom": resolve(import.meta.dir, "../node_modules/react-dom"),
			renderer: resolve(import.meta.dir, "../src/renderer"),
			shared: resolve(import.meta.dir, "../src/shared"),
		},
	},
	define: { "process.env": "{}", "process.platform": '"win32"' },
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(output, "entry.tsx"),
			name: "PublicSetupFixture",
			formats: ["iife"],
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "setup-fixture",
			enforce: "pre",
			load(id) {
				if (/[/\\]renderer[/\\]lib[/\\]electron-trpc\.ts$/.test(id))
					return "export const electronTrpc={system:{agentSetupStatus:{useQuery:()=>({data:{codex:false,claude:true},isFetching:false,refetch:async()=>{window.rechecked=true}})}}};";
				if (id.endsWith("useFolderFirstImport.ts"))
					return "export const useFolderFirstImport=()=>({start:async()=>{window.folderOpened=true}});";
				if (id.endsWith("add-repository-modal.ts"))
					return "export const useOpenNewProjectModal=()=>async()=>{window.projectCreated=true};";
				if (id.endsWith("GhAuthTerminal.tsx"))
					return "export const GhAuthTerminal=({command})=><pre data-testid='setup-terminal'>{command}</pre>;";
			},
		},
	],
});
await writeFile(
	resolve(output, "index.html"),
	'<html class="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>:root{font-family:system-ui;--background:#282a36;--foreground:#f8f8f2;--card:#30323f;--card-foreground:#f8f8f2;--popover:#30323f;--popover-foreground:#f8f8f2;--primary:#ff79c6;--primary-foreground:#282a36;--muted-foreground:#a7a9bb;--border:#484a59}html,body,#root{height:100%;margin:0}body{background:var(--background);color:var(--foreground)}pre{white-space:pre-wrap;word-break:break-all}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
);
await writeFile(
	resolve(output, "main.cjs"),
	`const {app,BrowserWindow}=require('electron');const fs=require('fs');const path=require('path');const assert=require('assert/strict');app.setPath('userData',path.join(__dirname,'profile'));app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');app.commandLine.appendSwitch('force-device-scale-factor','1');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:900,height:760,webPreferences:{backgroundThrottling:false}});try{await win.loadFile(path.join(__dirname,'index.html'));await new Promise(r=>setTimeout(r,800));const run=s=>win.webContents.executeJavaScript(s);const click=t=>run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+JSON.stringify(t)+").click()");assert.ok((await run('document.body.innerText')).includes('Your space to build'));await click('Open folder');assert.equal(await run('window.folderOpened'),true);await click('New project');assert.equal(await run('window.projectCreated'),true);await click('Recheck');assert.equal(await run('window.rechecked'),true);await click('Set up');await new Promise(r=>setTimeout(r,200));assert.ok(await run("!!document.querySelector('[role=dialog]')"));const cmd=await run("document.querySelector('[data-testid=setup-terminal]').textContent");assert.ok(Buffer.from(cmd.split(' ').at(-1),'base64').toString('utf16le').includes('https://chatgpt.com/codex/install.ps1'));await run("document.querySelector('[role=dialog] button:last-child').click()");await new Promise(r=>setTimeout(r,1000));assert.equal(await run("!!document.querySelector('[role=dialog]')"),false);for(const width of [380,800]){win.setSize(width,760);await new Promise(r=>setTimeout(r,300));assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);fs.writeFileSync(path.join(__dirname,'setup-'+width+'.png'),(await win.webContents.capturePage()).toPNG())}console.log('PASS setup: folder/create/recheck/install actions, modal, widths 380/800');app.exit(0)}catch(e){console.error(e);app.exit(1)}});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NoDefaultCurrentDirectoryInExePath;
const child = spawn(String(electron), [resolve(output, "main.cjs")], {
	env,
	windowsHide: true,
	stdio: "inherit",
});
const timer = setTimeout(() => child.kill(), 60000);
const code = await new Promise<number>((done) =>
	child.on("exit", (code) => done(code ?? 1)),
);
clearTimeout(timer);
process.exitCode = code;
