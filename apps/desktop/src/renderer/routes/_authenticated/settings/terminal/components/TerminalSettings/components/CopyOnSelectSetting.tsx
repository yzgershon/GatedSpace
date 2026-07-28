import { Label } from "@superset/ui/label";
import { Switch } from "@superset/ui/switch";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { setCopyOnSelectEnabledLocally } from "renderer/lib/terminal/copy-on-select-setting";

export function CopyOnSelectSetting() {
	const utils = electronTrpc.useUtils();

	const { data: enabled, isLoading } =
		electronTrpc.settings.getTerminalCopyOnSelect.useQuery();

	const setEnabled = electronTrpc.settings.setTerminalCopyOnSelect.useMutation({
		onMutate: async ({ enabled: next }) => {
			await utils.settings.getTerminalCopyOnSelect.cancel();
			const previous = utils.settings.getTerminalCopyOnSelect.getData();
			utils.settings.getTerminalCopyOnSelect.setData(undefined, next);
			// Terminals read this synchronously inside a selection handler, from a
			// module-level cache. Updating it here means the change applies to
			// terminals that are already open, without waiting for a round trip.
			setCopyOnSelectEnabledLocally(next);
			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (context?.previous !== undefined) {
				utils.settings.getTerminalCopyOnSelect.setData(
					undefined,
					context.previous,
				);
				setCopyOnSelectEnabledLocally(context.previous);
			}
		},
		onSettled: () => {
			utils.settings.getTerminalCopyOnSelect.invalidate();
		},
	});

	return (
		<div className="flex items-center justify-between">
			<div className="space-y-0.5 pr-4">
				<Label
					htmlFor="terminal-copy-on-select"
					className="text-sm font-medium"
				>
					Copy on select
				</Label>
				<p className="text-xs text-muted-foreground">
					Selecting text in a terminal copies it straight to the clipboard. Off
					by default, because it replaces whatever you had copied every time you
					drag across a terminal to read something.
				</p>
			</div>
			<Switch
				id="terminal-copy-on-select"
				checked={enabled ?? false}
				disabled={isLoading || setEnabled.isPending}
				onCheckedChange={(next) => setEnabled.mutate({ enabled: next })}
			/>
		</div>
	);
}
