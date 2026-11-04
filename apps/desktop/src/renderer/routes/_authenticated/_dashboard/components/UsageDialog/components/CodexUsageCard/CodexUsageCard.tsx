import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import { CodexUsageDetails } from "renderer/components/ClaudeAccountSwap/CodexUsageDetails";
import { useCodexAccountUsage } from "renderer/components/ClaudeAccountSwap/useCodexAccounts";

export function CodexUsageCard({
	id,
	label,
	current,
	isDefault,
}: {
	id: string;
	label: string;
	current: boolean;
	isDefault: boolean;
}) {
	const usage = useCodexAccountUsage(id);
	const icon = usePresetIcon("codex");
	return (
		<section
			aria-label={`Codex usage for ${label}`}
			className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-accent/20 p-4 ${current ? "border-primary/50" : "border-border"}`}
		>
			<div className="flex min-w-0 items-center gap-2">
				<img src={icon} alt="" className="size-4 shrink-0 object-contain" />
				<span
					title={`Codex · ${label}`}
					className="min-w-0 truncate text-sm font-semibold"
				>
					Codex · {label}
				</span>
			</div>
			{(current || isDefault) && (
				<span className="text-[11px] text-muted-foreground">
					{current ? "Current session" : "Default for new sessions"}
					{current && isDefault ? " · Default" : ""}
				</span>
			)}
			{usage.data?.limits && <CodexUsageDetails limits={usage.data.limits} />}
			{usage.isPending && (
				<output className="text-xs text-muted-foreground">
					Reading this account’s usage…
				</output>
			)}
			{(usage.isError || usage.data?.error) && (
				<output className="select-text cursor-text text-xs text-muted-foreground">
					{usage.data?.limits ? "Last reported usage. " : ""}
					{usage.data?.error ?? "Could not read usage."}{" "}
					<button
						type="button"
						className="text-primary underline-offset-2 hover:underline"
						onClick={() => void usage.refresh()}
					>
						Retry
					</button>
				</output>
			)}
			{usage.data?.updatedAt && (
				<span className="text-[10px] text-muted-foreground">
					Updated{" "}
					{new Date(usage.data.updatedAt).toLocaleTimeString([], {
						hour: "numeric",
						minute: "2-digit",
					})}
				</span>
			)}
		</section>
	);
}
