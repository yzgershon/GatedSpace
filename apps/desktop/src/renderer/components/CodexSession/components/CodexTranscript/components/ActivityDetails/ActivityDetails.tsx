import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { CodexItem } from "shared/codex-session/types";

export function ActivityDetails({
	item,
	running,
}: {
	item: CodexItem;
	running: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const [expandedImage, setExpandedImage] = useState<string | null>(null);
	const content = [item.command, item.input, item.text]
		.filter(Boolean)
		.join("\n\n");
	return (
		<div className="codex-tool-details">
			<div className="codex-tool-bar">
				<span>
					{item.command
						? "Shell"
						: item.changes?.length
							? "Changes"
							: item.activityType === "reasoning"
								? "Summary"
								: "Tool output"}
				</span>
				{item.exitCode !== undefined && (
					<span className={item.exitCode ? "codex-tool-error" : ""}>
						Exit {item.exitCode}
					</span>
				)}
				{content && (
					<button
						type="button"
						aria-label="Copy tool details"
						onClick={() => {
							void navigator.clipboard
								.writeText(content)
								.then(() => {
									setCopied(true);
									setCopyError(false);
								})
								.catch(() => setCopyError(true));
						}}
					>
						{copied ? <Check size={14} /> : <Copy size={14} />}
					</button>
				)}
			</div>
			{copyError && (
				<p role="alert" className="codex-tool-error select-text cursor-text">
					Copy failed. Select the output to copy it.
				</p>
			)}
			{item.cwd && <div className="codex-tool-directory">{item.cwd}</div>}
			{item.command && (
				<pre className="codex-tool-command">$ {item.command}</pre>
			)}
			{item.input && (
				<details className="codex-tool-input">
					<summary>Input</summary>
					<pre>{item.input}</pre>
				</details>
			)}
			{item.changes?.length ? (
				item.changes.map((change) => (
					<div className="codex-file-change" key={change.path}>
						<div>
							{change.path}
							<span>{change.kind}</span>
						</div>
						<pre>
							{change.diff.split("\n").map((line, index) => (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: immutable lines of this exact diff; identical lines are valid.
									key={index}
									className={
										line.startsWith("+")
											? "codex-diff-add"
											: line.startsWith("-")
												? "codex-diff-remove"
												: ""
									}
								>
									{line}
									{"\n"}
								</span>
							))}
						</pre>
					</div>
				))
			) : item.text ? (
				<pre className="codex-tool-output">{item.text}</pre>
			) : (
				<p className="codex-tool-empty">
					{running
						? "Waiting for output…"
						: item.images?.length
							? ""
							: "No text output."}
				</p>
			)}
			{item.images?.length ? (
				<div className="codex-tool-images">
					{item.images.map((src) => (
						<button
							type="button"
							key={src.slice(-120)}
							className={expandedImage === src ? "is-expanded" : ""}
							aria-label="Expand captured image"
							aria-expanded={expandedImage === src}
							onClick={() =>
								setExpandedImage(expandedImage === src ? null : src)
							}
						>
							<img src={src} alt="Captured tool result" loading="lazy" />
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
