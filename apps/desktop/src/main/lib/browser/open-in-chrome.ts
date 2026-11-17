import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isLocalPreviewUrl } from "../../../shared/local-preview";
import { localPreviews } from "./local-previews";
import { PreviewBrowserBridge } from "./preview-browser-bridge";

let bridge: PreviewBrowserBridge | undefined;

export async function chromeUrl(
	value: string,
	previews: Pick<PreviewBrowserBridge, "openUrl">,
) {
	if (isLocalPreviewUrl(value)) return previews.openUrl(value);
	const url = new URL(value);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	)
		throw new Error("Open a website or saved preview before opening Chrome.");
	return url.href;
}

export async function openInChrome(value: string) {
	let executable: string;
	if (process.platform === "win32") {
		const candidates = [
			process.env.ProgramFiles,
			process.env["ProgramFiles(x86)"],
			process.env.LOCALAPPDATA,
		]
			.filter((root): root is string => !!root)
			.map((root) =>
				join(root, "Google", "Chrome", "Application", "chrome.exe"),
			);
		const chrome = candidates.find(existsSync);
		if (!chrome)
			throw new Error(
				"Google Chrome was not found. Install Chrome, then try again.",
			);
		executable = chrome;
	} else
		executable =
			process.platform === "darwin" ? "/usr/bin/open" : "google-chrome";
	bridge ??= new PreviewBrowserBridge(localPreviews());
	const url = await chromeUrl(value, bridge);
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			executable,
			process.platform === "darwin"
				? ["-a", "Google Chrome", url]
				: ["--new-tab", url],
			{ stdio: "ignore", windowsHide: true },
		);
		child.once("error", () =>
			reject(
				new Error(
					"Could not launch Google Chrome. Check that it is installed.",
				),
			),
		);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
	return { success: true };
}
