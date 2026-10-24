import {
	ArrowRight,
	ArrowUpRight,
	Check,
	CircleHelp,
	FileCheck2,
	MessageSquare,
	Network,
	Pause,
	Play,
	Plus,
	Send,
	Settings2,
	Square,
	Users,
	X,
} from "lucide-react";
import { useState } from "react";
import { ArtifactReader } from "./components/ArtifactReader/ArtifactReader";
import { CreateEnsemble } from "./components/CreateEnsemble/CreateEnsemble";
import { ExchangeJournal } from "./components/ExchangeJournal/ExchangeJournal";
import { TeamMap } from "./components/TeamMap/TeamMap";
import type { EnsembleActions, EnsembleProps } from "./types";
import "./ensemble.css";

export function EnsembleWorkspace({
	snapshot,
	actions,
	workspaces,
	evidenceLabel,
}: EnsembleProps) {
	const [activeId, setActiveId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [selectedMember, setSelectedMember] = useState<string | null>(null);
	const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
	const [view, setView] = useState<"overview" | "work" | "history">("overview");
	const [settings, setSettings] = useState(false);
	const [to, setTo] = useState("coordinator");
	const [text, setText] = useState("");
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const group =
		snapshot.groups.find((g) => g.id === activeId) ?? snapshot.groups.at(-1);
	const run = async (fn: () => Promise<void>) => {
		setPending(true);
		setError("");
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : "The action failed.");
		} finally {
			setPending(false);
		}
	};
	const guarded: EnsembleActions = {
		...actions,
		resolve: (...args) => run(() => actions.resolve(...args)),
		openSession: (member) => {
			try {
				actions.openSession(member);
			} catch (e) {
				setError(
					e instanceof Error ? e.message : "Couldn't open the conversation.",
				);
			}
		},
	};
	const member = group?.members.find((m) => m.id === selectedMember);
	const activeCount = group?.members.filter((m) => !m.removed).length ?? 0;
	const needsInput =
		group?.status === "running"
			? group.members.find(
					(m) =>
						!m.removed &&
						snapshot.sessions.some(
							(s) =>
								s.key === m.key &&
								s.provider === m.provider &&
								s.status === "attention",
						),
				)
			: undefined;
	const newGroup = () => {
		setCreating(true);
		setSettings(false);
		setError("");
	};
	return (
		<div className="ensemble-workspace">
			{!creating && group && (
				<header className="en-feature-toolbar">
					<Network size={17} />
					<strong>Flock</strong>
					<span className="en-toolbar-divider" />
					<select
						aria-label="Select flock"
						value={group.id}
						onChange={(e) => {
							setActiveId(e.target.value);
							setSettings(false);
							setSelectedMember(null);
							setSelectedMessage(null);
						}}
					>
						{snapshot.groups.map((g) => (
							<option key={g.id} value={g.id}>
								{g.title}
							</option>
						))}
					</select>
					{evidenceLabel && (
						<span className="en-evidence" title={evidenceLabel}>
							Live preview
						</span>
					)}
					<button
						type="button"
						className="en-icon-button"
						aria-label="New flock"
						title="New flock"
						onClick={newGroup}
					>
						<Plus size={17} />
					</button>
				</header>
			)}
			<div className="en-layout">
				<main className="en-main">
					{creating || !group ? (
						<CreateEnsemble
							sessions={snapshot.sessions}
							workspaces={workspaces}
							evidenceLabel={evidenceLabel}
							actions={actions}
							onClose={() => setCreating(false)}
							onCreated={(id) => {
								setActiveId(id);
								setCreating(false);
							}}
						/>
					) : (
						<>
							<div className="en-goal-heading">
								<div>
									<div className="en-goal-meta">
										<span className={`en-group-state en-group-${group.status}`}>
											{group.status === "running"
												? "In collaboration"
												: group.status}
										</span>
										<span>
											{activeCount} members ·{" "}
											{
												group.messages.filter((m) => m.status === "answered")
													.length
											}{" "}
											responses
										</span>
									</div>
									<h1 className="en-sr-only">{group.title}</h1>
									<details className="en-brief-details">
										<summary>Mission brief</summary>
										<p>{group.goal}</p>
									</details>
								</div>
								<div className="en-controls">
									<button
										type="button"
										className="en-icon-button"
										aria-label="Edit brief and team"
										aria-pressed={settings}
										onClick={() => setSettings(!settings)}
									>
										<Settings2 size={18} />
									</button>
									{!["completed", "stopped"].includes(group.status) && (
										<>
											<button
												type="button"
												className={
													group.status === "running" ? "" : "en-primary"
												}
												disabled={pending}
												onClick={() =>
													void run(() =>
														actions.control(
															group.id,
															group.status === "running"
																? "pause"
																: group.status === "draft"
																	? "start"
																	: "resume",
														),
													)
												}
											>
												{group.status === "running" ? (
													<Pause size={15} />
												) : (
													<Play size={15} />
												)}
												{group.status === "running"
													? "Pause"
													: group.status === "draft"
														? "Start"
														: "Resume"}
											</button>
											{group.status !== "draft" && (
												<button
													type="button"
													className="en-icon-button"
													aria-label="Stop group and cancel queued deliveries"
													disabled={pending}
													onClick={() =>
														void run(() => actions.control(group.id, "stop"))
													}
												>
													<Square size={14} />
												</button>
											)}
										</>
									)}
								</div>
							</div>
							{(group.issue || error) && (
								<div className="en-notice" role="alert">
									<CircleHelp size={18} />
									<span>{error || group.issue}</span>
									{error && (
										<button
											type="button"
											className="en-icon-button"
											aria-label="Dismiss error"
											onClick={() => setError("")}
										>
											<X size={15} />
										</button>
									)}
								</div>
							)}
							{group.status === "paused" && (
								<p className="en-pause-note">
									New handoffs are paused. Current turns can finish.
								</p>
							)}
							{needsInput && (
								<output className="en-notice">
									<CircleHelp size={18} />
									<span>
										{needsInput.title} needs your input. Its next handoff is
										waiting.
									</span>
									<button
										type="button"
										onClick={() => guarded.openSession(needsInput)}
									>
										Open conversation
									</button>
								</output>
							)}
							{group.result && (
								<div className="en-result">
									<FileCheck2 size={23} />
									<div>
										<strong>Reviewed deliverable</strong>
										<p>
											{
												group.artifacts.find(
													(a) => a.id === group.result?.artifactId,
												)?.title
											}
										</p>
										<details className="en-result-notes">
											<summary>Completion notes</summary>
											<p>{group.result.text}</p>
										</details>
									</div>
									<button type="button" onClick={() => setView("work")}>
										Read the result
										<ArrowRight size={16} />
									</button>
								</div>
							)}
							{settings && (
								<section className="en-settings" aria-label="Group settings">
									<div className="en-section-heading">
										<h2>Brief & team</h2>
										<span>Pause before editing</span>
									</div>
									<form
										onSubmit={(e) => {
											e.preventDefault();
											const data = new FormData(e.currentTarget);
											void run(() =>
												actions.update(group.id, {
													goal: String(data.get("goal")),
													criteria: String(data.get("criteria")),
													maxMessages: Number(data.get("limit")),
												}),
											);
										}}
									>
										<label>
											Goal
											<textarea
												name="goal"
												defaultValue={group.goal}
												minLength={5}
												maxLength={8000}
												required
											/>
										</label>
										<label>
											Finish line
											<textarea
												name="criteria"
												defaultValue={group.criteria}
												minLength={5}
												maxLength={4000}
												required
											/>
										</label>
										<label>
											Delivery limit
											<input
												name="limit"
												type="number"
												min={4}
												max={100}
												defaultValue={group.maxMessages}
											/>
										</label>
										<button
											type="submit"
											disabled={
												pending || !["paused", "draft"].includes(group.status)
											}
										>
											Save brief
										</button>
									</form>
									<div className="en-members-edit">
										{group.members
											.filter((m) => !m.removed)
											.map((m) => (
												<div key={m.id}>
													<span>
														{m.title} · {m.role}
													</span>
													<button
														type="button"
														disabled={
															m.id === group.commanderId ||
															!["paused", "draft"].includes(group.status) ||
															pending
														}
														onClick={() =>
															void run(() =>
																actions.removeMember(group.id, m.id),
															)
														}
													>
														Remove
													</button>
												</div>
											))}
										<select
											aria-label="Add an existing session"
											value=""
											disabled={
												!["paused", "draft"].includes(group.status) || pending
											}
											onChange={(e) => {
												const s = snapshot.sessions.find(
													(s) => `${s.provider}:${s.key}` === e.target.value,
												);
												if (s)
													void run(() =>
														actions.addMember(group.id, {
															...s,
															id: "",
															role: "Contributor and reviewer",
														}),
													);
											}}
										>
											<option value="">Add a session…</option>
											{snapshot.sessions
												.filter(
													(s) =>
														!group.members.some(
															(m) =>
																!m.removed &&
																m.key === s.key &&
																m.provider === s.provider,
														),
												)
												.map((s) => (
													<option key={s.key} value={`${s.provider}:${s.key}`}>
														{s.title} · {s.provider}
													</option>
												))}
										</select>
									</div>
								</section>
							)}
							<div
								className="en-view-tabs"
								role="tablist"
								aria-label="Group views"
							>
								{(["overview", "work", "history"] as const).map((tab) => (
									<button
										type="button"
										role="tab"
										aria-selected={view === tab}
										id={`flock-${group.id}-${tab}-tab`}
										aria-controls={`flock-${group.id}-${tab}-panel`}
										tabIndex={view === tab ? 0 : -1}
										onKeyDown={(event) => {
											const tabs = ["overview", "work", "history"] as const;
											const index = tabs.indexOf(tab);
											const next =
												event.key === "ArrowRight"
													? (index + 1) % 3
													: event.key === "ArrowLeft"
														? (index + 2) % 3
														: event.key === "Home"
															? 0
															: event.key === "End"
																? 2
																: null;
											if (next === null) return;
											event.preventDefault();
											setView(tabs[next]);
											event.currentTarget.parentElement
												?.querySelectorAll<HTMLButtonElement>("[role=tab]")
												[next]?.focus();
										}}
										key={tab}
										onClick={() => setView(tab)}
									>
										{tab === "overview" ? (
											<Network size={16} />
										) : tab === "work" ? (
											<FileCheck2 size={16} />
										) : (
											<MessageSquare size={16} />
										)}
										{tab === "overview"
											? "Overview"
											: tab === "work"
												? "Shared work"
												: "History"}
									</button>
								))}
								<span className="en-budget">
									{
										group.messages.filter((m) => m.status !== "cancelled")
											.length
									}{" "}
									/ {group.maxMessages} deliveries
								</span>
							</div>
							{view === "overview" && (
								<div
									className="en-overview-grid"
									role="tabpanel"
									id={`flock-${group.id}-overview-panel`}
									aria-labelledby={`flock-${group.id}-overview-tab`}
								>
									<div>
										<TeamMap
											group={group}
											sessions={snapshot.sessions}
											selected={selectedMember}
											onSelect={setSelectedMember}
											onExchange={setSelectedMessage}
										/>
										{member && (
											<div className="en-member-focus">
												<span>
													<strong>{member.title}</strong> · {member.role}
												</span>
												<button
													type="button"
													onClick={() => guarded.openSession(member)}
												>
													Open conversation
													<ArrowUpRight size={14} />
												</button>
											</div>
										)}
										<ExchangeJournal
											group={group}
											selectedMember={selectedMember}
											selectedMessage={selectedMessage}
											onSelect={setSelectedMessage}
											actions={guarded}
										/>
									</div>
									<aside className="en-plan">
										<div className="en-section-heading">
											<h2>Definition of done</h2>
											<FileCheck2 size={16} />
										</div>
										<p className="en-criteria">{group.criteria}</p>
										<div className="en-section-heading en-task-heading">
											<h2>Tasks</h2>
											<span>
												{group.tasks.filter((t) => t.status === "done").length}/
												{group.tasks.length}
											</span>
										</div>
										{group.tasks.length === 0 && (
											<p className="en-muted">
												The coordinator will break the goal into concrete
												contributions.
											</p>
										)}
										{group.tasks.map((task) => (
											<div key={task.id} className="en-task">
												<span className={`en-task-mark en-task-${task.status}`}>
													{task.status === "done" ? (
														<Check size={13} />
													) : (
														<span />
													)}
												</span>
												<div>
													<strong>{task.title}</strong>
													<small>
														{
															group.members.find((m) => m.id === task.owner)
																?.title
														}{" "}
														· {task.status}
													</small>
													{task.dependsOn.length > 0 && (
														<small>After: {task.dependsOn.join(", ")}</small>
													)}
												</div>
											</div>
										))}
										<div className="en-section-heading en-task-heading">
											<h2>Decisions</h2>
										</div>
										{group.decisions.length === 0 ? (
											<p className="en-muted">No decisions recorded yet.</p>
										) : (
											group.decisions.slice(-6).map((d) => (
												<p className="en-decision" key={`${d.at}:${d.text}`}>
													{d.text}
												</p>
											))
										)}
										{group.artifacts.length > 0 && (
											<button
												className="en-work-link"
												type="button"
												onClick={() => setView("work")}
											>
												<FileCheck2 size={18} />
												<span>{group.artifacts.length} shared artifacts</span>
												<ArrowRight size={15} />
											</button>
										)}
									</aside>
								</div>
							)}
							{view === "work" && (
								<ArtifactReader key={group.id} group={group} />
							)}
							{view === "history" && (
								<section
									className="en-history"
									role="tabpanel"
									id={`flock-${group.id}-history-panel`}
									aria-labelledby={`flock-${group.id}-history-tab`}
								>
									<div className="en-section-heading">
										<h2>Activity log</h2>
										<span>{group.events.length} recorded events</span>
									</div>
									{group.events
										.slice()
										.reverse()
										.map((event) => (
											<button
												type="button"
												key={event.id}
												disabled={!event.messageId}
												onClick={() => {
													setView("overview");
													setSelectedMessage(event.messageId ?? null);
												}}
											>
												<time>
													{new Date(event.at).toLocaleTimeString([], {
														hour: "2-digit",
														minute: "2-digit",
													})}
												</time>
												<span
													className={`en-history-dot en-event-${event.kind}`}
												/>
												<span>
													<strong>{event.text}</strong>
													<small>
														{event.memberId
															? group.members.find(
																	(m) => m.id === event.memberId,
																)?.title
															: "Flock"}
													</small>
												</span>
												{event.messageId && <ArrowUpRight size={13} />}
											</button>
										))}
								</section>
							)}
							{!["completed", "stopped"].includes(group.status) && (
								<form
									className="en-composer"
									onSubmit={(e) => {
										e.preventDefault();
										void run(async () => {
											await actions.message(
												group.id,
												to === "coordinator" ? group.commanderId : to,
												text,
											);
											setText("");
										});
									}}
								>
									<div>
										<Users size={15} />
										<select
											aria-label="Message recipient"
											value={to}
											onChange={(e) => setTo(e.target.value)}
										>
											<option value="coordinator">Coordinator</option>
											<option value="all">Everyone</option>
											{group.members
												.filter((m) => !m.removed)
												.map((m) => (
													<option key={m.id} value={m.id}>
														{m.title}
													</option>
												))}
										</select>
										<span>
											{group.status === "paused"
												? "Held until you resume"
												: "Delivered when the recipient is ready"}
										</span>
									</div>
									<label className="en-sr-only" htmlFor="ensemble-message">
										Message the team
									</label>
									<textarea
										id="ensemble-message"
										value={text}
										rows={2}
										maxLength={8000}
										placeholder="Add context, challenge a direction, or ask for an update…"
										onChange={(e) => setText(e.target.value)}
									/>
									<button
										type="submit"
										className="en-send"
										aria-label="Send message"
										disabled={!text.trim() || pending}
									>
										<Send size={17} />
									</button>
								</form>
							)}
						</>
					)}
				</main>
			</div>
		</div>
	);
}
