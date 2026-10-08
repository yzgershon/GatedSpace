import { dirname, resolve } from "node:path";

// Imperative helpers can import the IPC client relatively, bypassing the
// renderer/lib alias. Keep browser fixtures isolated from Electron either way.
export function controlsPreviewIpcMock(desktop) {
	const client = resolve(desktop, "src/renderer/lib/trpc-client");
	const mock = resolve(desktop, "scripts/controls-preview/mock.ts");
	return {
		name: "controls-preview-ipc-mock",
		enforce: "pre",
		resolveId(source, importer) {
			if (!importer || !source.startsWith(".")) return;
			if (resolve(dirname(importer), source).replace(/\.tsx?$/, "") === client)
				return mock;
		},
	};
}
