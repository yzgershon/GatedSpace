import { Button } from "@superset/ui/button";
import { useState } from "react";
import { LuFolderOpen, LuFolderPlus } from "react-icons/lu";
import { AgentSetup } from "renderer/components/AgentSetup/AgentSetup";
import { useFolderFirstImport } from "renderer/routes/_authenticated/_dashboard/components/AddRepositoryModals/hooks/useFolderFirstImport/useFolderFirstImport";
import { useOpenNewProjectModal } from "renderer/stores/add-repository-modal";

export function PublicSetup() {
	const [error, setError] = useState<string | null>(null);
	const [opening, setOpening] = useState(false);
	const folder = useFolderFirstImport({ onError: setError });
	const newProject = useOpenNewProjectModal();
	return (
		<div className="h-full overflow-y-auto p-6 sm:p-10">
			<div className="mx-auto max-w-xl space-y-8 py-6">
				<div className="space-y-2">
					<p className="text-xs font-medium uppercase tracking-wider text-primary">
						On this PC
					</p>
					<h1 className="text-2xl font-semibold tracking-tight">
						Your space to build
					</h1>
					<p className="text-sm leading-relaxed text-muted-foreground">
						GatedSpace is ready. Projects and sessions stay on this computer. No
						GatedSpace account or GitHub sign-in is needed.
					</p>
				</div>
				<section className="space-y-3" aria-label="Connect your agents">
					<h2 className="font-medium">Connect your agents</h2>
					<p className="text-sm text-muted-foreground">
						Each PC needs the official agent tool and its own ChatGPT or Claude
						sign-in. Your GatedSpace Sync and GitHub connections are separate.
					</p>
					<AgentSetup agent="codex" />
					<AgentSetup agent="claude" />
				</section>
				<section className="space-y-3">
					<h2 className="font-medium">Start with a folder</h2>
					<p className="text-sm text-muted-foreground">
						Open any project folder or create a new one. GatedSpace prepares
						local Git history when needed; it never uploads or commits your
						existing files during setup.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={opening}
							onClick={async () => {
								setOpening(true);
								setError(null);
								try {
									await folder.start();
								} finally {
									setOpening(false);
								}
							}}
						>
							<LuFolderOpen className="mr-2 size-4" />
							{opening ? "Opening…" : "Open folder"}
						</Button>
						<Button variant="outline" onClick={() => void newProject()}>
							<LuFolderPlus className="mr-2 size-4" />
							New project
						</Button>
					</div>
				</section>
				{error && (
					<p
						role="alert"
						className="select-text cursor-text text-sm text-destructive"
					>
						{error}
					</p>
				)}
			</div>
		</div>
	);
}
