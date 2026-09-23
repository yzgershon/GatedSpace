import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { type CSSProperties, useMemo } from "react";
import {
	getDiffsTheme,
	getDiffViewerStyle,
} from "renderer/components/WorkspaceView/utils/code-theme";
import { useResolvedTheme } from "renderer/stores/theme";

export function ReviewPatch({ patch, path }: { patch: string; path: string }) {
	const theme = useResolvedTheme();
	const parsed = useMemo(() => {
		if (patch.length > 120_000) return null;
		try {
			const complete = /^diff --git |^--- /m.test(patch)
				? patch
				: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`;
			return (
				parsePatchFiles(complete, undefined, true).flatMap((p) => p.files)[0] ??
				null
			);
		} catch {
			return null;
		}
	}, [patch, path]);
	if (!parsed) return <pre className="codex-review-raw">{patch}</pre>;
	return (
		<FileDiff
			fileDiff={parsed}
			style={
				{
					...getDiffViewerStyle(theme, {}),
					"--diffs-font-size": "12px",
					"--diffs-line-height": "20px",
				} as CSSProperties
			}
			options={{
				diffStyle: "unified",
				expandUnchanged: false,
				theme: getDiffsTheme(theme),
				themeType: theme.type,
				overflow: "scroll",
				disableFileHeader: true,
				unsafeCSS: "* { user-select: text; -webkit-user-select: text; }",
			}}
		/>
	);
}
