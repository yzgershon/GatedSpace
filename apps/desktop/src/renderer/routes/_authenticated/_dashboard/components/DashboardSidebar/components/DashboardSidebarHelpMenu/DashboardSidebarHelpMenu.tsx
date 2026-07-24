import { COMPANY } from "@superset/shared/constants";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FaGithub } from "react-icons/fa6";
import {
	HiOutlineBookOpen,
	HiOutlineQuestionMarkCircle,
} from "react-icons/hi2";
import { IoBugOutline } from "react-icons/io5";
import { LuKeyboard, LuMegaphone } from "react-icons/lu";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { SubmitPromptDialog } from "./components/SubmitPromptDialog";

interface DashboardSidebarHelpMenuProps {
	isCollapsed: boolean;
}

export function DashboardSidebarHelpMenu({
	isCollapsed,
}: DashboardSidebarHelpMenuProps) {
	const navigate = useNavigate();
	const shortcutsHotkey = useHotkeyDisplay("SHOW_HOTKEYS").text;
	const [submitPromptOpen, setSubmitPromptOpen] = useState(false);
	const openUrlMutation = electronTrpc.external.openUrl.useMutation();

	const openExternal = (url: string) => {
		openUrlMutation.mutate(url);
	};

	const triggerButton = (
		<button
			type="button"
			aria-label="Help"
			className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
		>
			<HiOutlineQuestionMarkCircle className="size-4" />
		</button>
	);

	return (
		<>
			<DropdownMenu>
				{isCollapsed ? (
					<Tooltip delayDuration={300}>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent side="right">Help</TooltipContent>
					</Tooltip>
				) : (
					<DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
				)}
				<DropdownMenuContent
					align={isCollapsed ? "start" : "end"}
					side="top"
					className="w-56"
				>
					<DropdownMenuItem onSelect={() => setSubmitPromptOpen(true)}>
						<LuMegaphone className="size-4" />
						Submit a prompt
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => openExternal(COMPANY.DOCS_URL)}>
						<HiOutlineBookOpen className="size-4" />
						Documentation
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => navigate({ to: "/settings/keyboard" })}
					>
						<LuKeyboard className="size-4" />
						Keyboard Shortcuts
						{shortcutsHotkey !== "Unassigned" && (
							<DropdownMenuShortcut>{shortcutsHotkey}</DropdownMenuShortcut>
						)}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => openExternal(COMPANY.REPORT_ISSUE_URL)}
					>
						<IoBugOutline className="size-4" />
						Report Issue
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => openExternal(COMPANY.GITHUB_URL)}>
						<FaGithub className="size-4" />
						GitHub
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<SubmitPromptDialog
				open={submitPromptOpen}
				onOpenChange={setSubmitPromptOpen}
			/>
		</>
	);
}
