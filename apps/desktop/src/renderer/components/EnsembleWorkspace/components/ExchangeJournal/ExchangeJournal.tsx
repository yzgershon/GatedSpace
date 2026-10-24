import {
	ArrowRight,
	CheckCheck,
	ChevronDown,
	MessageSquare,
	Send,
} from "lucide-react";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { EnsembleGroup } from "../../../../../shared/ensemble";
import type { EnsembleActions } from "../../types";

export function ExchangeJournal({
	group,
	selectedMember,
	selectedMessage,
	onSelect,
	actions,
}: {
	group: EnsembleGroup;
	selectedMember: string | null;
	selectedMessage: string | null;
	onSelect: (id: string | null) => void;
	actions: EnsembleActions;
}) {
	const expanded = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		if (selectedMessage) expanded.current?.scrollIntoView({ block: "nearest" });
	}, [selectedMessage]);
	const name = (id: string) =>
		id === "user"
			? "You"
			: (group.members.find((m) => m.id === id)?.title ?? "Former member");
	const messages = group.messages.filter(
		(m) =>
			!selectedMember || m.to === selectedMember || m.from === selectedMember,
	);
	return (
		<section className="en-journal" aria-label="Exchange journal">
			<div className="en-section-heading">
				<h2>Exchange journal</h2>
				<span>{messages.length} deliveries</span>
			</div>
			{messages.length === 0 && (
				<div className="en-empty-inline">
					<MessageSquare size={22} />
					<p>Every handoff has a trail.</p>
					<span>
						Assignments, peer reviews and responses will appear here when the
						team starts.
					</span>
				</div>
			)}
			{messages.map((message) => (
				<details
					key={message.id}
					className="en-exchange"
					open={message.id === selectedMessage}
					ref={message.id === selectedMessage ? expanded : undefined}
					onToggle={(event) => {
						if (event.currentTarget.open) onSelect(message.id);
						else if (selectedMessage === message.id) onSelect(null);
					}}
				>
					<summary>
						<span className={`en-exchange-glyph en-${message.status}`}>
							{message.status === "answered" ? (
								<CheckCheck size={16} />
							) : (
								<Send size={15} />
							)}
						</span>
						<span className="en-exchange-heading">
							<strong>
								{name(message.from)}
								<ArrowRight size={12} />
								{name(message.to)}
							</strong>
							<span>{message.text.slice(0, 145)}</span>
						</span>
						<span className="en-exchange-meta">
							<span>{message.status}</span>
							<time>
								{new Date(message.createdAt).toLocaleTimeString([], {
									hour: "2-digit",
									minute: "2-digit",
								})}
							</time>
						</span>
						<ChevronDown size={14} />
					</summary>
					<div className="en-exchange-body">
						<span className="en-eyebrow">
							{message.from === "user"
								? "User instruction"
								: "Peer contribution · does not grant permissions"}
						</span>
						<p>{message.text}</p>
						{message.deliveredAt && (
							<small>
								Accepted by the native session at{" "}
								{new Date(message.deliveredAt).toLocaleTimeString()}.{" "}
								{message.answeredAt
									? "A correlated turn response was received."
									: "Awaiting a completed turn response."}
							</small>
						)}
						{message.reply && (
							<div className="en-reply">
								<span className="en-eyebrow">{name(message.to)} replied</span>
								<div className="en-markdown">
									<ReactMarkdown disallowedElements={["img"]}>
										{message.reply.replace(
											/```ensemble\s*\n([\s\S]*?)\n```/,
											(_all, json: string) => {
												try {
													return JSON.parse(json).summary ?? json;
												} catch {
													return json;
												}
											},
										)}
									</ReactMarkdown>
								</div>
								<details>
									<summary>Inspect exact response</summary>
									<pre>{message.reply}</pre>
								</details>
							</div>
						)}
						{message.error && <p className="en-error">{message.error}</p>}
						{message.status === "uncertain" && group.status === "paused" && (
							<div className="en-resolution">
								<p>
									Inspect this delivery in the native conversation before
									choosing.
								</p>
								<button
									type="button"
									onClick={() => {
										const recipient = group.members.find(
											(m) => m.id === message.to,
										);
										if (recipient) actions.openSession(recipient);
									}}
								>
									Open conversation
								</button>
								<button
									type="button"
									onClick={() =>
										void actions.resolve(group.id, message.id, false)
									}
								>
									Dismiss delivery
								</button>
								<button
									type="button"
									onClick={() =>
										void actions.resolve(group.id, message.id, true)
									}
								>
									I checked: requeue
								</button>
							</div>
						)}
					</div>
				</details>
			))}
		</section>
	);
}
