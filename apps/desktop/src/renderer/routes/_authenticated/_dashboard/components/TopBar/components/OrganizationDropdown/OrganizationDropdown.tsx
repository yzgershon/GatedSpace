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
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FiUsers } from "react-icons/fi";
import {
	HiCheck,
	HiChevronUpDown,
	HiOutlineArrowRightOnRectangle,
	HiOutlineCog6Tooth,
	HiOutlinePlus,
} from "react-icons/hi2";
import { HotkeyMenuShortcut } from "renderer/components/HotkeyMenuShortcut";
import { useCurrentPlan } from "renderer/hooks/useCurrentPlan";
import { useSignOut } from "renderer/hooks/useSignOut";
import { authClient } from "renderer/lib/auth-client";
import { isLocalMode, setAuthMode } from "renderer/lib/local-mode";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import {
	AddClaudeAccountDialog,
	ClaudeAccountSubmenu,
} from "./ClaudeAccountMenu";

export function OrganizationDropdown({
	variant = "topbar",
}: {
	variant?: "topbar" | "expanded" | "collapsed";
}) {
	const { data: session } = authClient.useSession();
	const collections = useCollections();
	const signOut = useSignOut();
	const navigate = useNavigate();

	// Lives here rather than in the submenu: the dropdown unmounts its content
	// on select, which would take the dialog down with it.
	const [addAccountOpen, setAddAccountOpen] = useState(false);

	const activeOrganizationId = session?.session?.activeOrganizationId;

	const { data: organizations } = useLiveQuery(
		(q) => q.from({ organizations: collections.organizations }),
		[collections],
	);

	const activeOrganization = organizations?.find(
		(o) => o.id === activeOrganizationId,
	);

	const userEmail = session?.user?.email;

	async function handleSignOut(): Promise<void> {
		await signOut();
	}

	const localMode = isLocalMode();
	const userName = session?.user?.name;
	const displayName = localMode
		? "Local"
		: (activeOrganization?.name ?? userName ?? "Organization");

	const { plan: currentPlan } = useCurrentPlan();
	const isPaid = currentPlan !== "free";
	const planLabel = currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1);
	const planBadge = isPaid ? (
		<Badge
			variant="default"
			className="px-1 py-0 text-[9px] leading-none uppercase tracking-wide h-3.5 bg-muted-foreground text-background transition-colors group-hover:bg-highlight group-hover:text-highlight-foreground"
		>
			{planLabel}
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
				<HiChevronUpDown className="ml-auto h-3.5 w-3.5 text-muted-foreground shrink-0" />
			</button>
		) : (
			<button
				type="button"
				className="group no-drag flex items-center gap-1.5 h-6 px-1.5 rounded border border-border/60 bg-secondary/50 hover:bg-secondary hover:border-border transition-all duration-150 ease-out focus:outline-none focus:ring-1 focus:ring-ring"
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
				<HiChevronUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			</button>
		);

	const contentAlign = variant === "topbar" ? "end" : "start";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
			<DropdownMenuContent
				align={contentAlign}
				className={
					variant === "expanded"
						? "w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
						: "w-56"
				}
			>
				{/* Organization */}
				{/* TODO(v1): Settings lives in the sidebar footer in v2; kept here for v1. Remove once v1 is gone. */}
				<DropdownMenuItem
					onSelect={() => navigate({ to: "/settings/account" })}
				>
					<HiOutlineCog6Tooth className="h-4 w-4" />
					<span>Settings</span>
					<HotkeyMenuShortcut hotkeyId="OPEN_SETTINGS" />
				</DropdownMenuItem>
				{!localMode && (
					<DropdownMenuItem
						onSelect={() => navigate({ to: "/settings/organization" })}
					>
						<FiUsers className="h-4 w-4" />
						<span>Manage members</span>
					</DropdownMenuItem>
				)}
				{!localMode && organizations && organizations.length > 0 && (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className="gap-2">
							<span>Switch organization</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{userEmail && (
								<DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
									{userEmail}
								</DropdownMenuLabel>
							)}
							{organizations.map((organization) => (
								<DropdownMenuItem
									key={organization.id}
									onSelect={() =>
										collections.switchOrganization(organization.id)
									}
									className="gap-2"
								>
									<Avatar
										size="xs"
										fullName={organization.name}
										image={organization.logo}
										className="rounded-md"
									/>
									<span className="flex-1 truncate">{organization.name}</span>
									{organization.id === activeOrganization?.id && (
										<HiCheck className="h-4 w-4 text-primary" />
									)}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={() => navigate({ to: "/create-organization" })}
							>
								<HiOutlinePlus className="h-4 w-4" />
								<span>Create organization</span>
							</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				)}

				{/* Claude account switcher: routes NEW agents to the chosen
				    account profile; running agents are untouched. Always shown —
				    it is also the only place a second account can be added. */}
				<ClaudeAccountSubmenu onAddAccount={() => setAddAccountOpen(true)} />

				<DropdownMenuSeparator />

				{/* Account */}
				{localMode ? (
					<DropdownMenuItem
						onSelect={() => {
							setAuthMode("cloud");
							window.location.reload();
						}}
						className="gap-2"
					>
						<HiOutlineArrowRightOnRectangle className="h-4 w-4" />
						<span>Sign in with an account</span>
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem onSelect={handleSignOut} className="gap-2">
						<HiOutlineArrowRightOnRectangle className="h-4 w-4" />
						<span>Log out</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>

			<AddClaudeAccountDialog
				open={addAccountOpen}
				onOpenChange={setAddAccountOpen}
			/>
		</DropdownMenu>
	);
}
