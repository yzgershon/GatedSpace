import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import {
	Check,
	ChevronDown,
	CircleAlert,
	ExternalLink,
	LoaderCircle,
	PackageCheck,
	X,
} from "lucide-react";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	BUILD_STAGE_LABELS,
	type BuildJob,
	buildRevision,
	isBuildActive,
	isBuildUrl,
} from "shared/build-status";
import "./build-status.css";

const icons = {
	building: LoaderCircle,
	verifying: PackageCheck,
	ready: Check,
	failed: CircleAlert,
};

export function BuildStatusView({
	jobs,
	error,
	onDismiss,
	onOpen,
}: {
	jobs: BuildJob[];
	error?: string;
	onDismiss: (job: BuildJob) => void;
	onOpen: (url: string) => void;
}) {
	const active = jobs.find(isBuildActive);
	const primary =
		jobs.find((job) => job.stage === "failed") ?? active ?? jobs[0];
	if (!primary && !error) return null;
	const stage = error ? "failed" : (primary?.stage ?? "failed");
	const Icon = icons[stage];
	const label = BUILD_STAGE_LABELS[stage];
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="build-status-chip no-drag"
					data-stage={stage}
					aria-label={`Installer builds: ${label}${primary ? `, ${primary.version}` : ""}`}
					title={`Installer builds: ${label}`}
				>
					<Icon
						size={14}
						className={
							active && stage !== "failed" ? "build-status-working" : undefined
						}
						aria-hidden="true"
					/>
					<span className="build-status-label">{label}</span>
					<span className="build-status-compact-label">Builds</span>
					{jobs.length > 1 && (
						<span className="build-status-count">{jobs.length}</span>
					)}
					<ChevronDown size={12} aria-hidden="true" />
				</button>
			</PopoverTrigger>
			<output className="sr-only" aria-live="polite">
				{jobs
					.map(
						(job) =>
							`${job.channel} ${job.version}: ${BUILD_STAGE_LABELS[job.stage]}`,
					)
					.join(". ")}
				{error}
			</output>
			<PopoverContent
				align="end"
				sideOffset={12}
				className="build-status-popover no-drag"
				aria-label="Installer builds"
			>
				<header className="build-status-heading">
					<span>Installer builds</span>
					<span>Windows</span>
				</header>
				{error && (
					<p className="build-status-error select-text cursor-text">{error}</p>
				)}
				<div className="build-status-jobs">
					{jobs.map((job) => {
						const JobIcon = icons[job.stage];
						return (
							<section
								key={job.id}
								className="build-status-job"
								data-stage={job.stage}
								aria-label={`${job.channel} ${job.version}`}
							>
								<div className="build-status-job-title">
									<strong>{job.version}</strong>
									<span className="build-status-channel">
										{job.channel === "public" ? "Public" : "Personal"}
									</span>
									{!isBuildActive(job) && (
										<button
											type="button"
											className="build-status-dismiss"
											aria-label={`Dismiss ${job.channel} ${job.version}`}
											onClick={() => onDismiss(job)}
										>
											<X size={14} />
										</button>
									)}
								</div>
								<div className="build-status-phase">
									<JobIcon size={14} aria-hidden="true" />
									<span>{BUILD_STAGE_LABELS[job.stage]}</span>
									<span className="build-status-architectures">
										{job.architectures
											.map((arch) => (arch === "arm64" ? "ARM64" : "x64"))
											.join(" · ")}
									</span>
								</div>
								<p className="select-text cursor-text">{job.message}</p>
								<footer>
									<span title={`Source commit ${job.sourceCommit}`}>
										{job.sourceCommit.slice(0, 7)}
										<span aria-hidden="true"> · </span>
										<time dateTime={job.updatedAt}>
											{new Date(job.updatedAt).toLocaleString(undefined, {
												month: "short",
												day: "numeric",
												hour: "numeric",
												minute: "2-digit",
											})}
										</time>
									</span>
									{job.url &&
										isBuildUrl(job.url) &&
										(job.stage === "ready" ||
											job.url.includes("/actions/runs/")) && (
											<button
												type="button"
												onClick={() => onOpen(job.url as string)}
											>
												{job.url.includes("/releases/")
													? "Downloads"
													: "Build details"}
												<ExternalLink size={12} aria-hidden="true" />
											</button>
										)}
								</footer>
								{job.stage === "ready" && job.channel === "personal" && (
									<div className="build-status-hint">
										Use Update when you’re ready to restart.
									</div>
								)}
							</section>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}

export function BuildStatus() {
	const [jobs, setJobs] = useState<BuildJob[]>([]);
	const [error, setError] = useState<string>();
	const dismiss = electronTrpc.buildStatus.dismiss.useMutation({
		onError: (cause) => toast.error(cause.message),
	});
	const open = electronTrpc.external.openUrl.useMutation({
		onError: (cause) => toast.error(cause.message),
	});
	electronTrpc.buildStatus.subscribe.useSubscription(undefined, {
		onData: (data) => {
			setJobs(data);
			setError(undefined);
		},
		onError: () =>
			setError(
				"Build status is unavailable. Reopen the app to reconnect; your build records are saved.",
			),
	});
	return (
		<BuildStatusView
			jobs={jobs}
			error={error}
			onDismiss={(job) =>
				dismiss.mutate({ id: job.id, revision: buildRevision(job) })
			}
			onOpen={(url) => open.mutate(url)}
		/>
	);
}
