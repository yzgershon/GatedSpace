import { ArrowDown, ArrowUpRight, Crown } from "lucide-react";
import type {
	EnsembleGroup,
	EnsembleSession,
} from "../../../../../shared/ensemble";
import { AgentIdentity } from "../AgentIdentity/AgentIdentity";

export function TeamMap({
	group,
	sessions,
	selected,
	onSelect,
	onExchange,
}: {
	group: EnsembleGroup;
	sessions: EnsembleSession[];
	selected: string | null;
	onSelect: (id: string | null) => void;
	onExchange: (id: string) => void;
}) {
	const members = group.members
		.filter((m) => !m.removed)
		.sort((a) => (a.id === group.commanderId ? -1 : 1));
	return (
		<section className="en-team" aria-label="Team and live exchanges">
			<div className="en-section-heading">
				<h2>The flock</h2>
				<button
					type="button"
					className="en-text-button"
					onClick={() => onSelect(null)}
				>
					{selected ? "Show everyone" : `${members.length} independent minds`}
				</button>
			</div>
			<div className="en-team-grid">
				{members.map((member) => {
					const live = sessions.find(
						(s) => s.key === member.key && s.provider === member.provider,
					);
					const pending = group.messages.filter(
						(m) => m.to === member.id && m.status === "queued",
					).length;
					const status = live?.status ?? "offline";
					const activity =
						status === "attention"
							? "Needs your input"
							: status === "working"
								? "Working"
								: status === "offline"
									? "Unavailable"
									: status === "error"
										? "Connection error"
										: pending
											? `${pending} queued`
											: "Ready";
					const task = group.tasks.findLast(
						(t) => t.owner === member.id && t.status !== "done",
					);
					return (
						<button
							type="button"
							className={`en-agent ${member.id === group.commanderId ? "en-coordinator" : ""}`}
							data-working={status === "working"}
							aria-pressed={selected === member.id}
							onClick={() =>
								onSelect(selected === member.id ? null : member.id)
							}
							key={member.id}
						>
							<div className="en-agent-top">
								<span className="en-avatar">
									<AgentIdentity provider={member.provider} size={29} />
								</span>
								{member.id === group.commanderId ? (
									<span className="en-crown">
										<Crown size={12} />
										Coordinator
									</span>
								) : (
									<ArrowUpRight size={15} className="en-muted" />
								)}
							</div>
							<strong>{member.title}</strong>
							<span className="en-agent-role">{member.role}</span>
							<span className={`en-status en-status-${status}`}>
								<i />
								{activity}
							</span>
							<span className="en-agent-task">
								{task?.title ??
									(group.status === "completed"
										? "Contribution preserved in the journal"
										: "Available for the next contribution")}
							</span>
						</button>
					);
				})}
			</div>
			{group.messages
				.filter(
					(m) =>
						m.from !== "user" &&
						(selected === null || m.from === selected || m.to === selected),
				)
				.slice(-3)
				.map((message) => (
					<button
						key={message.id}
						type="button"
						className="en-connection"
						data-state={message.status}
						onClick={() => onExchange(message.id)}
					>
						<span className="en-connection-line">
							<ArrowDown size={13} />
						</span>
						<span>
							{group.members.find((m) => m.id === message.from)?.title}
							<span className="en-muted"> → </span>
							{group.members.find((m) => m.id === message.to)?.title}
						</span>
						<span className="en-delivery-state">
							{message.kind === "review" ? "Review · " : ""}
							{message.status}
						</span>
						<ArrowUpRight size={13} />
					</button>
				))}
		</section>
	);
}
