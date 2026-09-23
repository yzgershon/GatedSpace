import { Copy } from "lucide-react";
import { useState } from "react";
import { CommentMarkdown } from "renderer/components/CommentMarkdown/CommentMarkdown";
import type { CodexItem } from "shared/codex-session/types";
import { PinnedUserMessage } from "./PinnedUserMessage";
import { TranscriptImages } from "./TranscriptImages";

export function TranscriptMessage({
	item,
	sticky,
	sessionKey,
}: {
	item: CodexItem;
	sticky?: boolean;
	sessionKey?: string;
}) {
	const [copied, setCopied] = useState(false);
	if (!item.text && !item.images?.length && !item.imagePaths?.length)
		return null;
	if (sticky && item.kind === "user")
		return <PinnedUserMessage item={item} sessionKey={sessionKey} />;
	return (
		<div
			data-prompt-id={item.kind === "user" ? item.id : undefined}
			className={
				item.kind === "user"
					? "codex-user-message"
					: `codex-assistant-message ${item.phase === "commentary" ? "codex-commentary" : ""}`
			}
		>
			<TranscriptImages item={item} sessionKey={sessionKey} />
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
