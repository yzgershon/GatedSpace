import { LuChevronDown, LuUserRound } from "react-icons/lu";

export function SessionAccountButton({
	provider,
	label,
	onClick,
	title,
}: {
	provider: "Codex" | "Claude";
	label?: string;
	onClick: () => void;
	title?: string;
}) {
	return (
		<div className="flex shrink-0 px-3 pb-1 pt-1.5">
			<button
				type="button"
				onClick={onClick}
				title={
					title ?? `${provider} account: ${label ?? "Identifying account"}`
				}
				aria-label={`${provider} account: ${label ?? "Identifying account"}. Switch account`}
				className="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<LuUserRound className="size-3 shrink-0" />
				<span className="min-w-0 truncate">
					{provider} ·{" "}
					<span className="text-foreground">
						{label ?? "Identifying account…"}
					</span>
				</span>
				<LuChevronDown className="size-3 shrink-0" />
			</button>
		</div>
	);
}
