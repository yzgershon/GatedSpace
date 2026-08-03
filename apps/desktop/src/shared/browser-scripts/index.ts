// Scripts the app is allowed to run inside a browser pane.
//
// browser.evaluateJS used to take `code: z.string()` and hand it straight to
// webContents.executeJavaScript. That is arbitrary script execution inside
// whatever page the pane has loaded — including a site the user is signed in
// to — reachable by anything that can make a tRPC call.
//
// It never needed to be general: there was exactly one caller, passing one
// constant. So the renderer now names a script and main owns the text.

import { ELEMENT_PICKER_SCRIPT } from "./element-picker-script";

export const BROWSER_SCRIPTS = {
	"element-picker": ELEMENT_PICKER_SCRIPT,
} as const;

export type BrowserScriptName = keyof typeof BROWSER_SCRIPTS;

export const BROWSER_SCRIPT_NAMES = Object.keys(BROWSER_SCRIPTS) as [
	BrowserScriptName,
	...BrowserScriptName[],
];

export function getBrowserScript(name: BrowserScriptName): string {
	return BROWSER_SCRIPTS[name];
}

export { ELEMENT_PICKER_SCRIPT } from "./element-picker-script";
