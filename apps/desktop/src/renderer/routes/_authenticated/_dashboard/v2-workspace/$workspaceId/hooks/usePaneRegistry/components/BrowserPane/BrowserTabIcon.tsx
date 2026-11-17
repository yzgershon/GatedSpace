import { FileText, Globe } from "lucide-react";
import { useState } from "react";
import type { BrowserPaneData } from "../../../../types";

/** Use the page's own identity; local previews without a favicon get a title mark. */
export function BrowserTabIcon({
	data,
}: {
	data: Pick<BrowserPaneData, "url" | "pageTitle" | "faviconUrl">;
}) {
	const [failedIcon, setFailedIcon] = useState<string | null>(null);
	let host = "";
	try {
		host = new URL(data.url).hostname.replace(/^www\./, "");
	} catch {
		/* Empty address. */
	}
	const local =
		data.url.startsWith("gatedspace-preview:") ||
		["localhost", "127.0.0.1"].includes(host);
	const name = (local ? data.pageTitle : host) || data.pageTitle || "";
	const favicon = data.faviconUrl;
	if (
		favicon &&
		favicon !== failedIcon &&
		/^(https?:|data:image\/|gatedspace-preview:)/i.test(favicon)
	)
		return (
			<img
				src={favicon}
				alt=""
				className="size-3.5 shrink-0 object-contain"
				draggable={false}
				onError={() => setFailedIcon(favicon)}
			/>
		);
	if (/\.(pdf|docx?|txt|md)([?#]|$)/i.test(data.url))
		return <FileText className="size-3.5 shrink-0" />;
	if (!name || data.url === "about:blank")
		return <Globe className="size-3.5 shrink-0" />;
	const colors = ["#bd93f9", "#8be9fd", "#ffb86c", "#ff79c6", "#a5d6a7"];
	const hash = [...name].reduce(
		(sum, letter) => (sum * 31 + (letter.codePointAt(0) ?? 0)) >>> 0,
		0,
	);
	return (
		<span
			aria-hidden="true"
			className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-semibold leading-none"
			style={{
				color: colors[hash % colors.length],
				background: `${colors[hash % colors.length]}20`,
			}}
		>
			{Array.from(name.trim())[0]?.toLocaleUpperCase()}
		</span>
	);
}
