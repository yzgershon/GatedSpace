import {
	ArrowUp,
	Check,
	ChevronDown,
	CornerDownRight,
	ListPlus,
	Pencil,
	Plus,
	Send,
	Square,
	Trash2,
	X,
} from "lucide-react";
import { useRef, useState } from "react";
import claude from "../../../../../packages/ui/src/assets/icons/preset-icons/claude.svg";
import codex from "../../../../../packages/ui/src/assets/icons/preset-icons/codex.svg";
import type { Provider } from "../data";

type QueuedMessage = { id: string; text: string };
export function MessageQueuePreview({ title }: { title: string }) {
	const [provider, setProvider] = useState<Provider>("codex");
	const [draft, setDraft] = useState("");
	const [queue, setQueue] = useState<QueuedMessage[]>([
		{ id: "first", text: "Also check how the sidebar looks in a narrow pane." },
	]);
	const [editing, setEditing] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [working, setWorking] = useState(true);
	const [paused, setPaused] = useState(false);
	const [messages, setMessages] = useState<string[]>([]);
	const [notice, setNotice] = useState("");
	const [removed, setRemoved] = useState<{
		message: QueuedMessage;
		index: number;
	} | null>(null);
	const [editText, setEditText] = useState("");
	const textarea = useRef<HTMLTextAreaElement>(null);
	const activeName = provider === "codex" ? "Codex" : "Claude";
	const send = () => {
		if (!draft.trim()) return;
		if (working || queue.length) {
			setQueue((rows) => [
				...rows,
				{ id: crypto.randomUUID(), text: draft.trim() },
			]);
			setNotice("Added to the queue.");
		} else {
			setMessages((rows) => [...rows, draft.trim()]);
			setWorking(true);
			setPaused(false);
			setNotice("Started a simulated turn.");
		}
		setDraft("");
	};
	const complete = () => {
		if (editing) {
			setNotice("Save or cancel your edit before finishing the demo turn.");
			return;
		}
		const next = queue[0];
		if (next && !paused) {
			setQueue((rows) => rows.slice(1));
			setMessages((rows) => [...rows, next.text]);
			setWorking(true);
			setNotice("The next queued message started automatically.");
		} else {
			setWorking(false);
			setNotice("The simulated turn finished.");
		}
	};
	const steer = (message: QueuedMessage) => {
		setQueue((rows) => rows.filter((q) => q.id !== message.id));
		setMessages((rows) => [...rows, message.text]);
		setWorking(true);
		setNotice("Sent to the current simulated turn.");
	};
	return (
		<section
			className={`queue-demo provider-${provider}`}
			aria-label="Message queue preview"
		>
			<header className="conversation-header">
				<img src={provider === "codex" ? codex : claude} alt={activeName} />
				<span>{title}</span>
				<select
					aria-label="Composer agent"
					value={provider}
					onChange={(e) => setProvider(e.target.value as Provider)}
				>
					<option value="codex">Codex</option>
					<option value="claude">Claude</option>
				</select>
			</header>
			<div className="conversation-scroll">
				<div className="user-message">
					Make the recent sessions easier to scan, and keep my next prompts
					queued by the composer.
				</div>
				<p>
					I'll refine the navigation and keep queued prompts editable until
					they're sent.
				</p>
				<button
					type="button"
					className="tool-summary"
					onClick={() =>
						setNotice(
							"This demo does not run commands or modify your sessions.",
						)
					}
				>
					<ChevronDown />
					Edited files, ran commands
				</button>
				<p className="conversation-copy">
					You can keep writing while I work. Your next message will wait here,
					in order.
				</p>
				{messages.map((message, index) => (
					<div className="user-message" key={`${index}-${message}`}>
						{message}
					</div>
				))}
				{working ? (
					<div className="working-word">Refining the navigation</div>
				) : (
					<div className="turn-complete">
						<Check />
						Demo turn complete
					</div>
				)}
			</div>
			<div className="composer-dock">
				{queue.length > 0 && (
					<section className="attached-queue" aria-label="Queued messages">
						<div className="queue-caption">
							<span>
								<ListPlus />
								{queue.length === 1 ? "Queued next" : `${queue.length} queued`}
							</span>
							<span>{paused ? "Paused" : "Sends after this turn"}</span>
						</div>
						{(expanded ? queue : queue.slice(0, 2)).map((message, index) => (
							<div
								className="queued-row"
								key={message.id}
								data-queued-id={message.id}
							>
								{editing === message.id ? (
									<form
										className="queue-edit"
										onSubmit={(e) => {
											e.preventDefault();
											if (!editText.trim()) return;
											setQueue((rows) =>
												rows.map((q) =>
													q.id === message.id
														? { ...q, text: editText.trim() }
														: q,
												),
											);
											setEditing(null);
										}}
									>
										<label>
											Edit queued message
											<textarea
												aria-label="Edit queued message"
												value={editText}
												onChange={(e) => setEditText(e.target.value)}
												ref={(el) => el?.focus()}
												onKeyDown={(e) => {
													if (e.key === "Escape") setEditing(null);
												}}
											/>
										</label>
										<div>
											<button type="button" onClick={() => setEditing(null)}>
												Cancel
											</button>
											<button
												className="primary"
												type="submit"
												disabled={!editText.trim()}
											>
												Save message
											</button>
										</div>
									</form>
								) : (
									<>
										<span className="queue-order">{index + 1}</span>
										<button
											type="button"
											className="queued-text"
											title={message.text}
											aria-label={`Edit queued message ${index + 1}`}
											onClick={() => {
												setEditing(message.id);
												setEditText(message.text);
											}}
										>
											{message.text}
										</button>
										<span className="queue-actions">
											<button
												type="button"
												className="icon-button"
												aria-label={`Edit message ${index + 1}`}
												title="Edit"
												onClick={() => {
													setEditing(message.id);
													setEditText(message.text);
												}}
											>
												<Pencil />
											</button>
											<button
												type="button"
												className="icon-button"
												aria-label={`Delete message ${index + 1}`}
												title="Remove from queue"
												onClick={() => {
													setRemoved({ message, index });
													setQueue((rows) =>
														rows.filter((q) => q.id !== message.id),
													);
												}}
											>
												<Trash2 />
											</button>
											<button
												type="button"
												className="steer-button"
												aria-label={`Send message ${index + 1} now`}
												title="Send to the current turn"
												onClick={() => steer(message)}
											>
												<CornerDownRight />
												<span>
													{provider === "codex" ? "Steer" : "Send now"}
												</span>
											</button>
										</span>
									</>
								)}
							</div>
						))}
						{queue.length > 2 && (
							<button
								type="button"
								className="queue-expand"
								onClick={() => setExpanded(!expanded)}
							>
								{expanded
									? "Show less"
									: `Show ${queue.length - 2} more queued`}
								<ChevronDown />
							</button>
						)}
					</section>
				)}
				<div className="message-composer">
					<label className="sr-only" htmlFor="composer-draft">
						Message {activeName}
					</label>
					<textarea
						id="composer-draft"
						ref={textarea}
						value={draft}
						placeholder={
							working ? "Add your next message..." : `Message ${activeName}...`
						}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (
								e.key === "Enter" &&
								!e.shiftKey &&
								!e.nativeEvent.isComposing
							) {
								e.preventDefault();
								send();
							}
						}}
					/>
					<div className="composer-controls">
						<button
							type="button"
							className="icon-button"
							aria-label="Attachment preview information"
							onClick={() =>
								setNotice(
									"The final queue will keep attachments with their message. This demo uses text.",
								)
							}
						>
							<Plus />
						</button>
						<span>{provider === "codex" ? "GPT-6 Astra" : "Claude Opus"}</span>
						{working && (
							<button
								type="button"
								className="icon-button stop-button"
								aria-label="Stop demo turn"
								title="Stop and pause the queue"
								onClick={() => {
									setWorking(false);
									setPaused(true);
									setNotice(
										"Stopped. Your queued messages are kept and paused.",
									);
								}}
							>
								<Square />
							</button>
						)}
						<button
							type="button"
							className="send-button"
							aria-label={
								working || queue.length ? "Queue message" : "Send message"
							}
							title={working || queue.length ? "Queue message" : "Send message"}
							disabled={!draft.trim()}
							onClick={send}
						>
							{working || queue.length ? <ListPlus /> : <ArrowUp />}
						</button>
					</div>
				</div>
				{removed && (
					<output className="queue-undo">
						<span>Queued message removed</span>
						<button
							type="button"
							onClick={() => {
								setQueue((rows) => {
									const next = [...rows];
									next.splice(
										Math.min(removed.index, next.length),
										0,
										removed.message,
									);
									return next;
								});
								setRemoved(null);
							}}
						>
							Undo
						</button>
						<button
							type="button"
							className="icon-button"
							aria-label="Dismiss removed message notice"
							onClick={() => setRemoved(null)}
						>
							<X />
						</button>
					</output>
				)}
				{paused && queue.length > 0 && (
					<button
						type="button"
						className="resume-queue"
						onClick={() => {
							setPaused(false);
							const next = queue[0];
							setQueue((rows) => rows.slice(1));
							setMessages((rows) => [...rows, next.text]);
							setWorking(true);
							setNotice("Queue resumed.");
						}}
					>
						<Send />
						Resume queue
					</button>
				)}
			</div>
			<footer className="simulation-controls">
				<button
					type="button"
					onClick={complete}
					disabled={!working || Boolean(editing)}
				>
					<Check />
					Finish demo turn
				</button>
				<output>{notice || "Local simulation. No messages are sent."}</output>
			</footer>
		</section>
	);
}
