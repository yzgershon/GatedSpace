import type { SelectInvitation } from "@superset/db/schema";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { useState } from "react";
import {
	HiEllipsisVertical,
	HiOutlineArrowPath,
	HiOutlineXMark,
} from "react-icons/hi2";
import { authClient } from "renderer/lib/auth-client";

interface InvitationActionsProps {
	invitation: SelectInvitation;
}

export function InvitationActions({ invitation }: InvitationActionsProps) {
	const [isCanceling, setIsCanceling] = useState(false);
	const [isResending, setIsResending] = useState(false);

	const handleResend = async () => {
		setIsResending(true);
		try {
			const result = await authClient.organization.inviteMember({
				organizationId: invitation.organizationId,
				email: invitation.email,
				role: (invitation.role ?? "member") as "admin" | "member" | "owner",
				resend: true,
			});
			if (result.error) {
				toast.error(result.error.message ?? "Failed to resend invitation");
				return;
			}
			toast.success(`Invitation resent to ${invitation.email}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to resend invitation",
			);
		} finally {
			setIsResending(false);
		}
	};

	const handleCancel = async () => {
		setIsCanceling(true);
		try {
			const result = await authClient.organization.cancelInvitation({
				invitationId: invitation.id,
			});
			if (result.error) {
				toast.error(result.error.message ?? "Failed to cancel invitation");
				return;
			}
			toast.success("Invitation canceled");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to cancel invitation",
			);
		} finally {
			setIsCanceling(false);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className="h-8 w-8">
					<HiEllipsisVertical className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onSelect={handleResend}
					disabled={isResending || isCanceling}
					className="gap-2"
				>
					<HiOutlineArrowPath className="h-4 w-4" />
					{isResending ? "Resending..." : "Resend email"}
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={handleCancel}
					disabled={isCanceling || isResending}
					className="text-destructive gap-2"
				>
					<HiOutlineXMark className="h-4 w-4" />
					Cancel
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
