import { PaneTitleEditor } from "@superset/panes";
import { DropdownMenuTrigger } from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { ChevronDown, LoaderCircle } from "lucide-react";

/** The compact title and shared rename field used by real terminals and the preview. */
export function TerminalSessionTitle({
	title,
	paneId,
	isActive,
	isLoading,
	onRename,
}: {
	title: string;
	paneId: string;
	isActive: boolean;
	isLoading?: boolean;
	onRename: (title: string | undefined) => void;
}) {
	return (
		<PaneTitleEditor
			title={title}
			paneId={paneId}
			isActive={isActive}
			onRename={onRename}
		>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Terminal sessions"
					title={title}
					className={cn(
						"flex min-w-0 items-center gap-1.5 rounded py-1 text-[length:var(--gs-pane-title-size,14px)] font-medium transition-colors hover:bg-muted hover:text-foreground",
						isActive ? "text-foreground" : "text-muted-foreground",
					)}
					onMouseDown={(event) => event.stopPropagation()}
					onClick={(event) => event.stopPropagation()}
				>
					<span className="min-w-0 truncate">{title}</span>
					{isLoading ? (
						<LoaderCircle className="size-3 shrink-0 animate-spin" />
					) : (
						<ChevronDown className="size-3 shrink-0" />
					)}
				</button>
			</DropdownMenuTrigger>
		</PaneTitleEditor>
	);
}
