/**
 * The appearance picker.
 *
 * Two named layouts rather than a pile of toggles: the difference between them
 * is a dozen coordinated decisions (see `skin-tokens.ts`), and exposing those
 * individually would let someone build a half-and-half that neither layout was
 * designed for.
 *
 * "VS Code Style" exists so there is a way back that is not reinstalling an
 * older build.
 */
import { cn } from "@superset/ui/utils";
import {
	type AppearanceSkin,
	useV2UserPreferences,
} from "renderer/hooks/useV2UserPreferences";

const OPTIONS: {
	id: AppearanceSkin;
	label: string;
	description: string;
}[] = [
	{
		id: "liquid-glass",
		label: "Liquid Glass",
		description:
			"Panes float as cards with rounded corners. Agents sit in the header, and the sidebar nests each workspace's live sessions.",
	},
	{
		id: "vscode",
		label: "VS Code Style",
		description:
			"Panes tile edge to edge, agents get their own row, and the account stays in the top bar. What GatedSpace looked like through 1.17.48.",
	},
];

/**
 * A miniature of each layout. Deliberately abstract — enough to tell the two
 * apart at a glance without pretending to be a screenshot that would then have
 * to be kept in sync with the real thing.
 */
function SkinThumb({ skin }: { skin: AppearanceSkin }) {
	const glass = skin === "liquid-glass";
	return (
		<div className="flex h-[52px] w-[76px] shrink-0 overflow-hidden rounded-md border border-border bg-background">
			<div className="w-[17px] shrink-0 border-border/70 border-r bg-sidebar" />
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="h-[9px] shrink-0 border-border/70 border-b bg-muted/40" />
				{!glass && (
					<div className="h-[5px] shrink-0 border-border/50 border-b" />
				)}
				<div
					className={cn(
						"grid min-h-0 flex-1 grid-cols-2",
						glass ? "gap-[3px] p-[3px]" : "gap-px",
					)}
				>
					{[0, 1, 2, 3].map((cell) => (
						<div
							className={cn(
								"bg-card",
								glass && "rounded-[2px] border border-border/80",
							)}
							key={cell}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

export function SkinSection() {
	const { preferences, setAppearanceSkin } = useV2UserPreferences();

	return (
		<div>
			<div className="font-medium text-sm">Layout</div>
			<p className="mt-1 mb-3 text-muted-foreground text-sm">
				Changes apply immediately. Nothing about your workspaces, sessions or
				panes is affected.
			</p>
			<div className="flex flex-col gap-2">
				{OPTIONS.map((option) => {
					const active = preferences.appearanceSkin === option.id;
					return (
						<button
							className={cn(
								"flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
								active
									? "border-highlight/60 bg-highlight/5"
									: "border-border hover:bg-muted/40",
							)}
							key={option.id}
							onClick={() => setAppearanceSkin(option.id)}
							type="button"
						>
							<SkinThumb skin={option.id} />
							<span className="min-w-0">
								<span className="flex items-center gap-2 font-medium text-sm">
									{option.label}
									{active ? (
										<span className="rounded bg-highlight/15 px-1.5 py-px text-[10px] text-highlight uppercase tracking-wide">
											Active
										</span>
									) : null}
								</span>
								<span className="mt-1 block text-muted-foreground text-sm">
									{option.description}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
