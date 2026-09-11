import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superset/ui/alert-dialog";
import { Avatar } from "@superset/ui/atoms/Avatar";
import { Badge } from "@superset/ui/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { Check, Palette } from "lucide-react";
import { useState } from "react";
import {
	HiChevronUpDown,
	HiOutlineArrowRightOnRectangle,
	HiOutlineClipboardDocumentList,
	HiOutlineCog6Tooth,
	HiOutlineSparkles,
} from "react-icons/hi2";
import { LuClock } from "react-icons/lu";
import { HotkeyMenuShortcut } from "renderer/components/HotkeyMenuShortcut";
import { GATED_FEATURES, usePaywall } from "renderer/components/Paywall";
import { useCurrentPlan } from "renderer/hooks/useCurrentPlan";
import { useSignOut } from "renderer/hooks/useSignOut";
import { authClient } from "renderer/lib/auth-client";
import { isLocalMode, setAuthMode } from "renderer/lib/local-mode";
import {
	tasksSearchFromFilters,
	useTasksFilterStore,
} from "renderer/routes/_authenticated/_dashboard/tasks/stores/tasks-filter-state";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { requestAccountSwap } from "renderer/stores/claude-account-swap";
import { getLastSettingsRoute } from "renderer/stores/last-settings-route";
import { SYSTEM_THEME_ID, useThemeStore } from "renderer/stores/theme/store";

/**
 * Every installed theme, grouped by type, with the active one ticked.
 *
 * Selecting one applies it and lets the menu close on its own — Radix closes
 * the whole tree on select, which is the behaviour wanted: pick a theme, see
 * the app in it, no second click to dismiss.
 */
function ThemeMenuItems() {
	const activeThemeId = useThemeStore((state) => state.activeThemeId);
	const setTheme = useThemeStore((state) => state.setTheme);
	const themes = useThemeStore((state) => state.getAllThemes)();

	const item = (id: string, name: string) => (
		<DropdownMenuItem
			key={id}
			onSelect={() => setTheme(id)}
			className="gap-2 text-[13px]"
		>
			<Check
				className={cn(
					"size-3.5 shrink-0",
					activeThemeId === id ? "opacity-100" : "opacity-0",
				)}
			/>
			<span className="min-w-0 flex-1 truncate">{name}</span>
		</DropdownMenuItem>
	);

	const dark = themes.filter((theme) => theme.type === "dark");
	const light = themes.filter((theme) => theme.type === "light");

	return (
		<>
			{item(SYSTEM_THEME_ID, "Match system")}
			{dark.length > 0 ? (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-[11px] text-muted-foreground/60">
						Dark
					</DropdownMenuLabel>
					{dark.map((theme) => item(theme.id, theme.name))}
				</>
			) : null}
			{light.length > 0 ? (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-[11px] text-muted-foreground/60">
						Light
					</DropdownMenuLabel>
					{light.map((theme) => item(theme.id, theme.name))}
				</>
			) : null}
		</>
	);
}

export function OrganizationDropdown({
	variant = "topbar",
}: {
	variant?: "topbar" | "expanded" | "collapsed" | "account";
}) {
	const { data: session } = authClient.useSession();
	const collections = useCollections();
	const signOut = useSignOut();
	const navigate = useNavigate();

	// Confirm before leaving local mode, since switching to cloud
	// reloads into a sign-in + setup flow a local user usually doesn't want.
	const [confirmCloudOpen, setConfirmCloudOpen] = useState(false);

	const activeOrganizationId = session?.session?.activeOrganizationId;

	const { data: organizations } = useLiveQuery(
		(q) => q.from({ organizations: collections.organizations }),
		[collections],
	);

	const activeOrganization = organizations?.find(
		(o) => o.id === activeOrganizationId,
	);

	async function handleSignOut(): Promise<void> {
		await signOut();
	}

	const localMode = isLocalMode();
	const userName = session?.user?.name;
	const displayName = localMode
		? "Local"
		: (activeOrganization?.name ?? userName ?? "Organization");

	// Tasks reopens where you left it, and is paywalled — same behaviour the
	// sidebar rail had before this moved here.
	const { gateFeature } = usePaywall();
	const {
		tab: lastTab,
		assignee: lastAssignee,
		search: lastSearch,
		typeTab: lastTypeTab,
		projectFilter: lastProjectFilter,
		linearProjectFilter: lastLinearProjectFilter,
	} = useTasksFilterStore();

	const handleTasksClick = () => {
		gateFeature(GATED_FEATURES.TASKS, () => {
			navigate({
				to: "/tasks",
				search: tasksSearchFromFilters({
					tab: lastTab,
					assignee: lastAssignee,
					search: lastSearch,
					typeTab: lastTypeTab,
					projectFilter: lastProjectFilter,
					linearProjectFilter: lastLinearProjectFilter,
				}),
			});
		});
	};

	const { plan: currentPlan } = useCurrentPlan();
	const isPaid = currentPlan !== "free";
	/*
	 * "Ultra" is cosmetic — it is not a plan the backend knows about and nothing
	 * keys off it. The real plan still gates everything; this only changes the
	 * word on the badge.
	 *
	 * Magenta at full strength whether or not the row is hovered. It used to be
	 * `bg-muted-foreground` until `group-hover`, which read as a disabled chip
	 * that lit up on approach — the opposite of what a badge is for.
	 */
	const planBadge = isPaid ? (
		<Badge
			variant="default"
			className="h-3.5 bg-fuchsia-500 px-1 py-0 text-[9px] text-white uppercase leading-none tracking-wide"
		>
			Ultra
		</Badge>
	) : null;

	const triggerButton =
		variant === "collapsed" ? (
			<button
				type="button"
				className="flex size-8 items-center justify-center rounded-md transition-colors text-muted-foreground hover:bg-accent/50 hover:text-foreground"
				aria-label="Organization menu"
			>
				<Avatar
					size="xs"
					fullName={activeOrganization?.name}
					image={activeOrganization?.logo}
					className="rounded size-4"
				/>
			</button>
		) : variant === "account" ? (
			/*
			 * The reference's account block: a 24px rounded-square avatar, the name,
			 * and the plan STACKED beneath it rather than sitting inline as a chip.
			 *
			 * Stacking is what makes it read as an identity card and not another
			 * row of the list above it, which matters because it is the last thing
			 * in the column and has to close it. The chevron goes: the theme and
			 * settings buttons to the right of it (rendered by the caller, outside
			 * this trigger) already say the row is interactive, and three affordances
			 * in a 28px row is one too many.
			 */
			<button
				type="button"
				className="group flex min-w-0 shrink items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
				aria-label="Organization menu"
			>
				<Avatar
					size="xs"
					fullName={activeOrganization?.name}
					image={activeOrganization?.logo}
					className="size-6 shrink-0 rounded-[7px]"
				/>
				<span className="flex min-w-0 flex-col leading-[1.15]">
					<span className="truncate font-medium text-[13px] text-foreground">
						{displayName}
					</span>
					{isPaid ? (
						<span className="font-bold text-[9.5px] text-fuchsia-500 uppercase tracking-[0.06em]">
							Ultra
						</span>
					) : null}
				</span>
			</button>
		) : variant === "expanded" ? (
			<button
				type="button"
				className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground min-w-0"
				aria-label="Organization menu"
			>
				<Avatar
					size="xs"
					fullName={activeOrganization?.name}
					image={activeOrganization?.logo}
					className="rounded size-4 shrink-0"
				/>
				<span className="truncate">{displayName}</span>
				{planBadge}
				<HiChevronUpDown className="ml-auto size-3.5 text-muted-foreground shrink-0" />
			</button>
		) : (
			<button
				type="button"
				className="group no-drag flex items-center gap-1.5 h-6 px-1.5 rounded border border-border/60 bg-secondary/50 hover:bg-secondary hover:border-border transition-[background-color,border-color,color] duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-ring"
				aria-label="Organization menu"
			>
				<Avatar
					size="xs"
					fullName={activeOrganization?.name}
					image={activeOrganization?.logo}
					className="rounded size-4"
				/>
				<span className="text-xs font-medium truncate max-w-32">
					{displayName}
				</span>
				{planBadge}
				<HiChevronUpDown className="size-3.5 text-muted-foreground shrink-0" />
			</button>
		);

	const contentAlign = variant === "topbar" ? "end" : "start";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
			<DropdownMenuContent
				align={contentAlign}
				// Don't restore focus to the trigger on close: items here open dialogs
				// (Add Claude account, Sign in with an account), and the focus handoff
				// otherwise dismisses the dialog the same frame it opens (it flashes).
				onCloseAutoFocus={(e) => e.preventDefault()}
				className={
					variant === "expanded" || variant === "account"
						? "w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
						: "w-56"
				}
			>
				{/* Automations and Tasks & PRs live here rather than in the sidebar
				    rail: the rail is for surfaces you move between constantly
				    (workspaces, sessions, usage), and these two were taking permanent
				    space for occasional visits. */}
				{!localMode && (
					<>
						<DropdownMenuItem onSelect={() => navigate({ to: "/automations" })}>
							<LuClock className="size-4" />
							<span>Automations</span>
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={handleTasksClick}>
							<HiOutlineClipboardDocumentList className="size-4" />
							<span>Tasks &amp; PRs</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				)}

				{/*
				 * Theme, as a hover submenu.
				 *
				 * It was an icon button in the sidebar footer that CYCLED
				 * light -> dark -> system. Two problems: the moon promised a binary
				 * the app does not have — a dozen themes are installed and the one
				 * in use is Solarized Light, which is neither — and cycling is
				 * destructive on a set that size, since one stray click loses the
				 * theme you had chosen with no way back but hunting for it again.
				 *
				 * A submenu is also what frees the footer row to hold only who you
				 * are, what today cost, and settings.
				 */}
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="gap-2">
						<Palette className="size-4" />
						<span>Theme</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-[60vh] w-52 overflow-y-auto">
						<ThemeMenuItems />
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />

				{/* Organization */}
				{/* TODO(v1): Settings lives in the sidebar footer in v2; kept here for v1. Remove once v1 is gone. */}
				<DropdownMenuItem
					onSelect={() => navigate({ to: getLastSettingsRoute() })}
				>
					<HiOutlineCog6Tooth className="size-4" />
					<span>Settings</span>
					<HotkeyMenuShortcut hotkeyId="OPEN_SETTINGS" />
				</DropdownMenuItem>
				{/*
				 * "Manage members" and "Switch organization" were removed on
				 * 2026-08-18. Both are cloud-org features this install has no use
				 * for — there is one org and one member — so they were two dead
				 * rows in a menu whose whole job is to be short. The routes and the
				 * `collections.switchOrganization` action still exist; only the
				 * entry points are gone.
				 */}

				{/*
				 * ONE row, not a submenu with its own list.
				 *
				 * The submenu that used to be here was a second, parallel way to
				 * change accounts: it set a global default, could not name the
				 * account under "auto", and moved nothing you were looking at. That
				 * was the whole reason a switch was impossible to confirm. It now
				 * opens the same picker `/swap` opens, so there is one control and
				 * one wording for what will actually happen.
				 */}
				<DropdownMenuItem
					// Next tick, so the closing menu's focus/dismiss cycle finishes
					// before the dialog mounts — otherwise it dismisses in the same
					// frame and flashes for one.
					onSelect={() =>
						setTimeout(
							() => requestAccountSwap({ kind: "default", from: "menu" }),
							0,
						)
					}
					className="gap-2"
				>
					<HiOutlineSparkles className="size-4" />
					<span>Swap Claude account</span>
					<span className="ml-auto font-mono text-muted-foreground text-xs">
						/swap
					</span>
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				{/* Account */}
				{localMode ? (
					<DropdownMenuItem
						onSelect={() => setConfirmCloudOpen(true)}
						className="gap-2"
					>
						<HiOutlineArrowRightOnRectangle className="size-4" />
						<span>Sign in with an account</span>
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem onSelect={handleSignOut} className="gap-2">
						<HiOutlineArrowRightOnRectangle className="size-4" />
						<span>Log out</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>

			<AlertDialog open={confirmCloudOpen} onOpenChange={setConfirmCloudOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Sign in with an account?</AlertDialogTitle>
						<AlertDialogDescription>
							This reloads GatedSpace into account mode, where you sign in with
							GitHub or Google to sync your work across devices and use teams.
							Your current local setup stays on this machine, and you can switch
							back anytime with "Use GatedSpace without an account" on the
							sign-in screen.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Stay local</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setAuthMode("cloud");
								window.location.reload();
							}}
						>
							Sign in with an account
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DropdownMenu>
	);
}
