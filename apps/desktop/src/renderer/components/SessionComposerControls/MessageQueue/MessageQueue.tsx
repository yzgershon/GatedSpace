import {
	ChevronDown,
	CornerDownRight,
	ListPlus,
	Pencil,
	Play,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import type { useMessageQueue } from "./useMessageQueue";
import type { useQueuedMessageEdit } from "./useQueuedMessageEdit";
import "./message-queue.css";

export function MessageQueue({
	queue,
	provider,
	editor,
}: {
	queue: ReturnType<typeof useMessageQueue>;
	provider: "claude" | "codex";
	editor: ReturnType<typeof useQueuedMessageEdit>;
}) {
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		queue.setError(undefined);
		try {
			await action();
		} catch (error) {
			queue.setError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	const { entries, paused, sendingId } = queue.state;
	if (!editor.id && !entries.length && !queue.error && !queue.state.error)
		return null;
	return (
		<section
			className={`session-message-queue queue-${provider}`}
			aria-label="Queued messages"
		>
			{editor.id && (
				<output className="message-queue-editing">
					<Pencil size={14} aria-hidden="true" />
					<span>Editing in composer · queue paused</span>
					<button
						type="button"
						disabled={editor.busy}
						onClick={() => void editor.cancel()}
					>
						Cancel edit
					</button>
				</output>
			)}
			{entries.length > 1 && (
				<div className="message-queue-caption">{entries.length} queued</div>
			)}
			{(expanded ? entries : entries.slice(0, 2)).map((entry, index) => (
				<div className="message-queue-row" key={entry.id}>
					<ListPlus size={15} aria-hidden="true" />
					<button
						type="button"
						className="message-queue-text"
						title={entry.prompt.text || "Attached images"}
						aria-label={`Edit queued message ${index + 1}`}
						disabled={
							busy ||
							editor.busy ||
							Boolean(editor.id) ||
							sendingId === entry.id
						}
						onClick={() => void editor.begin(entry.id)}
					>
						{entry.prompt.text || "Attached images"}
						{entry.prompt.images?.length ? (
							<small>
								{" "}
								· {entry.prompt.images.length} image
								{entry.prompt.images.length === 1 ? "" : "s"}
							</small>
						) : null}
					</button>
					<button
						type="button"
						title={
							provider === "codex"
								? "Steer the current turn"
								: "Send to the current turn"
						}
						aria-label={`Send queued message ${index + 1} now`}
						disabled={
							busy || editor.busy || Boolean(editor.id) || Boolean(sendingId)
						}
						onClick={() => void run(() => queue.steer(entry.id))}
					>
						<CornerDownRight size={15} />
						<span>
							{sendingId === entry.id
								? "Sending"
								: provider === "codex"
									? "Steer"
									: "Send now"}
						</span>
					</button>
					<button
						type="button"
						title="Edit message"
						aria-label={`Edit message ${index + 1}`}
						disabled={
							busy ||
							editor.busy ||
							Boolean(editor.id) ||
							sendingId === entry.id
						}
						onClick={() => void editor.begin(entry.id)}
					>
						<Pencil size={14} />
					</button>
					<button
						type="button"
						title="Delete queued message"
						aria-label={`Delete queued message ${index + 1}`}
						disabled={
							busy ||
							editor.busy ||
							Boolean(editor.id) ||
							sendingId === entry.id
						}
						onClick={() => void run(() => queue.remove(entry.id))}
					>
						<Trash2 size={14} />
					</button>
				</div>
			))}
			{entries.length > 2 && (
				<button
					type="button"
					className="message-queue-expand"
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? "Show less" : `${entries.length - 2} more queued`}
					<ChevronDown size={13} />
				</button>
			)}
			{paused && !editor.id && entries.length > 0 && (
				<button
					type="button"
					className="message-queue-resume"
					disabled={busy}
					onClick={() => void run(queue.resume)}
				>
					<Play size={13} />
					Queue paused · Resume
				</button>
			)}
			{(queue.error || queue.state.error) && (
				<p className="select-text cursor-text message-queue-error">
					{queue.error || queue.state.error}
				</p>
			)}
		</section>
	);
}
