import { Copy } from "lucide-react";
import { useState } from "react";
import { CommentMarkdown } from "renderer/components/CommentMarkdown/CommentMarkdown";
import type { CodexItem } from "shared/codex-session/types";

export function TranscriptMessage({ item }: { item: CodexItem }) {
	const [copied, setCopied] = useState(false);
	if (!item.text) return null;
	return (
		<div
			className={
				item.kind === "user"
					? "codex-user-message"
					: `codex-assistant-message ${item.phase === "commentary" ? "codex-commentary" : ""}`
			}
		>
			{item.kind === "user" ? (
				<p>{item.text}</p>
			) : (
				<CommentMarkdown body={item.text} />
			)}
			{item.kind === "assistant" && item.phase !== "commentary" && (
				<button
					type="button"
					className="codex-copy"
					aria-label="Copy response"
					onClick={() => {
						void navigator.clipboard
							.writeText(item.text)
							.then(() => setCopied(true))
							.catch(() => setCopied(false));
					}}
				>
					<Copy size={14} />
					{copied ? "Copied" : ""}
				</button>
			)}
		</div>
	);
}
