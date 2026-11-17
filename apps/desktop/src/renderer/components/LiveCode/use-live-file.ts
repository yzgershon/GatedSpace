import { useEffect, useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { codePathKey } from "./live-code-files";

export function useLiveFile({
	paneId,
	workspaceId,
	provider,
	path,
	revision,
	deleted,
	refresh,
}: {
	paneId: string;
	workspaceId: string;
	provider: "claude" | "codex";
	path: string;
	revision?: string;
	deleted?: boolean;
	refresh: number;
}) {
	const baselines = useRef(new Map<string, string>());
	const [file, setFile] = useState({
		path: "",
		text: "",
		baseline: "",
		error: "",
		loaded: false,
	});
	const [watchError, setWatchError] = useState("");
	// biome-ignore lint/correctness/useExhaustiveDependencies: provider revisions and manual retry must refresh even if the path is unchanged
	useEffect(() => {
		if (!path) return;
		let disposed = false,
			pending = false,
			again = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const session = { provider, key: paneId };
		setWatchError("");
		const load = async () => {
			if (disposed || document.hidden) return;
			if (pending) {
				again = true;
				return;
			}
			pending = true;
			try {
				if (deleted) {
					setFile({
						path,
						text: "",
						baseline: baselines.current.get(path) ?? "",
						error: "",
						loaded: true,
					});
					return;
				}
				const result = await electronTrpcClient.filesystem.readFile.query({
					workspaceId,
					session,
					absolutePath: path,
					encoding: "utf-8",
					maxBytes: 512 * 1024,
				});
				if (disposed) return;
				if (result.exceededLimit)
					throw new Error(
						"This file is larger than the 512 KB live preview limit.",
					);
				if (
					result.kind !== "text" ||
					typeof result.content !== "string" ||
					result.content.includes("\0")
				)
					throw new Error(
						"This is a binary file. Live code displays text files.",
					);
				if (!baselines.current.has(path)) {
					if (baselines.current.size >= 16) {
						const oldest = baselines.current.keys().next().value;
						if (oldest) baselines.current.delete(oldest);
					}
					baselines.current.set(path, result.content);
				}
				setFile((old) =>
					old.path === path &&
					old.loaded &&
					old.text === result.content &&
					!old.error
						? old
						: {
								path,
								text: result.content,
								baseline: baselines.current.get(path) ?? "",
								error: "",
								loaded: true,
							},
				);
			} catch (error) {
				if (!disposed)
					setFile((old) => ({
						...(old.path === path
							? old
							: { path, text: "", baseline: "", loaded: false }),
						error:
							error instanceof Error
								? error.message
								: "Could not read this file.",
					}));
			} finally {
				pending = false;
				if (again && !disposed) {
					again = false;
					void load();
				}
			}
		};
		const schedule = () => {
			clearTimeout(timer);
			timer = setTimeout(() => void load(), 90);
		};
		void load();
		// One directory watch survives atomic saves. No polling or agent calls.
		const subscription = electronTrpcClient.filesystem.watchPath.subscribe(
			{
				workspaceId,
				session,
				absolutePath: path.slice(0, path.lastIndexOf("/") + 1),
				recursive: false,
			},
			{
				onData: (batch) => {
					if (disposed) return;
					if (
						batch.events.some(
							(event) =>
								event.kind === "overflow" ||
								[event.absolutePath, event.oldAbsolutePath].some(
									(value) =>
										value && codePathKey("", value) === codePathKey("", path),
								),
						)
					)
						schedule();
				},
				onError: (error) => {
					if (!disposed)
						setWatchError(error.message || "Live updates disconnected.");
				},
			},
		);
		const visible = () => {
			if (!document.hidden) schedule();
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			disposed = true;
			clearTimeout(timer);
			subscription.unsubscribe();
			document.removeEventListener("visibilitychange", visible);
		};
	}, [paneId, workspaceId, provider, path, revision, deleted, refresh]);
	return {
		...(file.path === path
			? file
			: { path, text: "", baseline: "", error: "", loaded: false }),
		watchError,
	};
}
