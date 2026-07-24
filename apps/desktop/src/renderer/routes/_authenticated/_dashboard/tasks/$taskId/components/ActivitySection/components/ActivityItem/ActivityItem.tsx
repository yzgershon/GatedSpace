import { formatDistanceToNow } from "date-fns";

interface ActivityItemProps {
	avatarUrl?: string | null;
	avatarFallback: string;
	actorName: string;
	action: string;
	timestamp: Date;
}

export function ActivityItem({
	avatarUrl,
	avatarFallback,
	actorName,
	action,
	timestamp,
}: ActivityItemProps) {
	return (
		<div className="flex items-start gap-3">
			{avatarUrl ? (
				<img
					src={avatarUrl}
					alt=""
					className="size-6 rounded-full shrink-0 mt-0.5"
				/>
			) : (
				<div className="size-6 rounded-full bg-muted flex items-center justify-center text-xs shrink-0 mt-0.5">
					{avatarFallback}
				</div>
			)}
			<div className="text-sm">
				<span className="text-foreground">{actorName}</span>
				<span className="text-muted-foreground">
					{" "}
					{action} · {formatDistanceToNow(timestamp, { addSuffix: true })}
				</span>
			</div>
		</div>
	);
}
