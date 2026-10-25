import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { AccountSignIn } from "./AccountSignIn";
export function AddClaudeAccountDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[420px]">
				<DialogHeader>
					<DialogTitle>Add Claude Code account</DialogTitle>
					<DialogDescription>
						Connect your subscription using the official browser sign-in.
					</DialogDescription>
				</DialogHeader>
				{open && (
					<AccountSignIn
						provider="claude"
						onDone={() => {}}
						onBack={() => onOpenChange(false)}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
