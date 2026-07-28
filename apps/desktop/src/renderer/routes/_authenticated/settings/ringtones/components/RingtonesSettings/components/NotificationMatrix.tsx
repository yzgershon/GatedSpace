/**
 * The event × channel grid.
 *
 * Rows are the three things an agent can do that are worth interrupting you
 * for; columns are how. Rendered as a grid rather than nested toggle lists
 * because the question people arrive with is comparative — "which of these
 * makes noise?" — and a grid answers it without reading any labels twice.
 */
import { Switch } from "@superset/ui/switch";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	DEFAULT_NOTIFICATION_MATRIX,
	EVENT_TYPE_LABELS,
	NOTIFIABLE_EVENT_TYPES,
	type NotifiableEventType,
	type NotificationChannel,
} from "shared/notification-matrix";

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
	sound: "Sound",
	banner: "Banner",
};

export function NotificationMatrixSetting({ muted }: { muted: boolean }) {
	const utils = electronTrpc.useUtils();
	const { data: matrix = DEFAULT_NOTIFICATION_MATRIX, isLoading } =
		electronTrpc.settings.getNotificationMatrix.useQuery();

	const setMatrix = electronTrpc.settings.setNotificationMatrix.useMutation({
		// Optimistic: a switch that waits for a database round trip before moving
		// feels broken, and this one is flipped in bursts while people tune it.
		onMutate: async ({ matrix: next }) => {
			await utils.settings.getNotificationMatrix.cancel();
			const previous = utils.settings.getNotificationMatrix.getData();
			utils.settings.getNotificationMatrix.setData(
				undefined,
				next as typeof previous,
			);
			return { previous };
		},
		onError: (_error, _vars, context) => {
			if (context?.previous) {
				utils.settings.getNotificationMatrix.setData(
					undefined,
					context.previous,
				);
			}
		},
		onSettled: () => utils.settings.getNotificationMatrix.invalidate(),
	});

	const toggle = (
		eventType: NotifiableEventType,
		channel: NotificationChannel,
		enabled: boolean,
	) => {
		setMatrix.mutate({
			matrix: {
				...matrix,
				[eventType]: { ...matrix[eventType], [channel]: enabled },
			},
		});
	};

	return (
		<div>
			<div className="mb-3">
				<h3 className="mb-1 text-sm font-medium">What gets notified</h3>
				<p className="text-xs text-muted-foreground">
					A banner is the notification your operating system shows. Sound and
					banner are separate, so an agent finishing can be worth knowing about
					without being worth a noise.
				</p>
			</div>

			<div className="overflow-hidden rounded-lg border border-border">
				<div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2">
					<span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
						Event
					</span>
					{(Object.keys(CHANNEL_LABELS) as NotificationChannel[]).map(
						(channel) => (
							<span
								key={channel}
								className="w-16 shrink-0 text-center text-xs font-medium text-muted-foreground"
							>
								{CHANNEL_LABELS[channel]}
							</span>
						),
					)}
				</div>

				<div className="divide-y divide-border">
					{NOTIFIABLE_EVENT_TYPES.map((eventType) => (
						<div key={eventType} className="flex items-center gap-3 px-4 py-3">
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium">
									{EVENT_TYPE_LABELS[eventType].title}
								</div>
								<div className="text-xs text-muted-foreground">
									{EVENT_TYPE_LABELS[eventType].description}
								</div>
							</div>
							{(Object.keys(CHANNEL_LABELS) as NotificationChannel[]).map(
								(channel) => (
									<div
										key={channel}
										className="flex w-16 shrink-0 justify-center"
									>
										<Switch
											aria-label={`${CHANNEL_LABELS[channel]} for "${EVENT_TYPE_LABELS[eventType].title}"`}
											checked={matrix[eventType][channel]}
											// The global mute already silences everything, so leaving
											// the sound column live would offer a switch that
											// demonstrably does nothing when flipped.
											disabled={isLoading || (channel === "sound" && muted)}
											onCheckedChange={(enabled) =>
												toggle(eventType, channel, enabled)
											}
										/>
									</div>
								),
							)}
						</div>
					))}
				</div>
			</div>

			{muted ? (
				<p className="mt-2 text-xs text-muted-foreground">
					Notification sounds are off, so the sound column is disabled. Banners
					still work.
				</p>
			) : null}
		</div>
	);
}
