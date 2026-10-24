import { ArrowUpRight, CheckCheck, Download, FileText } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { EnsembleGroup } from "../../../../../shared/ensemble";

export function ArtifactReader({ group }: { group: EnsembleGroup }) {
	const [selected, setSelected] = useState("");
	const [revision, setRevision] = useState<number | null>(null);
	const artifact =
		group.artifacts.find((a) => a.id === selected) ?? group.artifacts.at(-1);
	const index =
		revision === null ? (artifact?.versions.length ?? 1) - 1 : revision;
	const version = artifact?.versions[index] ?? artifact?.versions.at(-1);
	const name = (id: string) =>
		group.members.find((m) => m.id === id)?.title ?? id;
	return (
		<section
			className="en-artifact-panel"
			role="tabpanel"
			id={`flock-${group.id}-work-panel`}
			aria-labelledby={`flock-${group.id}-work-tab`}
		>
			<div className="en-section-heading">
				<h2>Shared work</h2>
				<span>{group.artifacts.length} artifacts</span>
			</div>
			{!artifact ? (
				<div className="en-empty-inline">
					<FileText size={24} />
					<p>A result you can trace.</p>
					<span>
						Drafts, revisions and independent reviews stay attached to the work.
					</span>
				</div>
			) : (
				<>
					<div className="en-artifact-tabs">
						{group.artifacts.map((a) => (
							<button
								type="button"
								key={a.id}
								aria-pressed={a.id === artifact.id}
								onClick={() => {
									setSelected(a.id);
									setRevision(null);
								}}
							>
								<FileText size={15} />
								{a.title}
							</button>
						))}
					</div>
					<div className="en-artifact-toolbar">
						<span>
							{name(version?.author ?? "")} <ArrowUpRight size={12} />
						</span>
						<select
							aria-label="Artifact revision"
							value={index}
							onChange={(e) => setRevision(Number(e.target.value))}
						>
							{artifact.versions.map((v, i) => (
								<option key={`${v.at}:${i}`} value={i}>
									Revision {i + 1}
									{i === artifact.versions.length - 1 ? " · latest" : ""}
								</option>
							))}
						</select>
						<button
							type="button"
							aria-label="Download artifact as Markdown"
							onClick={() => {
								const url = URL.createObjectURL(
									new Blob([version?.body ?? ""], { type: "text/markdown" }),
								);
								const a = document.createElement("a");
								a.href = url;
								a.download = `${artifact.id.replace(/[^a-z0-9-]/gi, "-")}.md`;
								a.click();
								setTimeout(() => URL.revokeObjectURL(url), 1000);
							}}
						>
							<Download size={15} />
						</button>
					</div>
					<article className="en-markdown en-artifact-document">
						<ReactMarkdown disallowedElements={["img"]}>
							{version?.body ?? ""}
						</ReactMarkdown>
					</article>
					<div className="en-reviews">
						{artifact.reviews
							.filter((r) => r.version === index + 1)
							.map((review) => (
								<div key={review.messageId}>
									<CheckCheck size={17} />
									<div>
										<strong>
											{name(review.author)} reviewed revision {review.version}
										</strong>
										<p>{review.text}</p>
									</div>
								</div>
							))}
						{!artifact.reviews.some((r) => r.version === index + 1) && (
							<p className="en-muted">
								This revision has not received a recorded review yet.
							</p>
						)}
					</div>
				</>
			)}
		</section>
	);
}
