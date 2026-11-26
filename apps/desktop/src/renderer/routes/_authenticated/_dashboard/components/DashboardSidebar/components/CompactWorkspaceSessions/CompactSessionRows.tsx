import { ChevronRight } from "lucide-react";
import { useState } from "react";
import "./compact-workspace.css";

export interface CompactSession {
	id: string;
	title: string;
	icon: string | undefined;
	status: string;
	statusLabel: string;
}
export interface CompactSessionGroup {
	id: string;
	title: string;
	isActive: boolean;
	sessions: CompactSession[];
}

export function CompactSessionRows({
	groups,
	onSelect,
}: {
	groups: CompactSessionGroup[];
	onSelect: (paneId: string) => void;
}) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	return (
		<div className="compact-session-list">
			{groups.map((group) => {
				const first = group.sessions[0];
				if (!first) return null;
				const multiple = group.sessions.length > 1;
				const expanded = !collapsed.has(group.id);
				return (
					<div key={group.id} className="compact-session-group">
						<div className="compact-session-row" data-active={group.isActive}>
							{multiple ? (
								<button
									type="button"
									className="compact-session-disclosure"
									aria-label={`${expanded ? "Collapse" : "Expand"} ${group.title} sessions`}
									aria-expanded={expanded}
									onClick={() =>
										setCollapsed((previous) => {
											const next = new Set(previous);
											if (next.has(group.id)) next.delete(group.id);
											else next.add(group.id);
											return next;
										})
									}
								>
									<ChevronRight
										size={13}
										className={expanded ? "rotate-90" : undefined}
									/>
								</button>
							) : (
								<span className="compact-session-indent" />
							)}
							<button
								type="button"
								className="compact-session-open"
								onClick={() => onSelect(first.id)}
								title={group.title}
								aria-label={`Open ${group.title}${multiple ? `, ${group.sessions.length} sessions` : `, ${first.statusLabel}`}`}
							>
								<img src={first.icon} alt="" draggable={false} />
								<span className="compact-session-title">
									{group.title || first.title}
								</span>
								{multiple ? (
									<span className="compact-session-count">
										{group.sessions.length}
									</span>
								) : (
									<span
										className="compact-session-status"
										data-status={first.status}
										aria-hidden="true"
									/>
								)}
							</button>
						</div>
						{multiple && expanded && (
							<div className="compact-session-children">
								{group.sessions.map((session) => (
									<button
										key={session.id}
										type="button"
										className="compact-session-open"
										onClick={() => onSelect(session.id)}
										title={`${session.title} · ${session.statusLabel}`}
										aria-label={`Open ${session.title}, ${session.statusLabel}`}
									>
										<img src={session.icon} alt="" draggable={false} />
										<span className="compact-session-title">
											{session.title}
										</span>
										<span
											className="compact-session-status"
											data-status={session.status}
											aria-hidden="true"
										/>
									</button>
								))}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
