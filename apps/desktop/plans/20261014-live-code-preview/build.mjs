import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { build } from 'vite';
const directory = dirname(fileURLToPath(import.meta.url));
const output = resolve(directory, 'dist');
await mkdir(output, {recursive: true});
await build({configFile: false, envFile: false, logLevel:'warn', plugins:[react(),tailwindcss()],
 define:{'process.env.NODE_ENV':JSON.stringify('production')},
 resolve:{alias:{renderer:resolve(directory,'../../src/renderer'),shared:resolve(directory,'../../src/shared')}},
 build:{outDir:output,emptyOutDir:false,lib:{entry:resolve(directory,'Preview.tsx'),formats:['iife'],name:'LiveCodePreview',fileName:()=> 'preview.js',cssFileName:'preview'}}
});
await writeFile(resolve(output,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GatedSpace · Live code</title><link rel="stylesheet" href="./preview.css"></head><body><div id="app"></div><script src="./preview.js"></script></body></html>');
console.log(output);
