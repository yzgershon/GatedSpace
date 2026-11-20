import { Button } from "@superset/ui/button";
import { AgentSetup } from "renderer/components/AgentSetup/AgentSetup";
import { openFirstRunSetup } from "renderer/components/FirstRunSetup/FirstRunSetup";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "../../../../../utils/settings-search";
import { SyncSettings } from "../SyncSettings";

export function PublicAccountSettings({
	visibleItems,
}: {
	visibleItems?: SettingItemId[] | null;
}) {
	const showProfile = isItemVisible(
		SETTING_ITEM_ID.ACCOUNT_PROFILE,
		visibleItems,
	);
	const showAccount =
		showProfile ||
		isItemVisible(SETTING_ITEM_ID.ACCOUNT_SYNC, visibleItems) ||
		isItemVisible(SETTING_ITEM_ID.ACCOUNT_SIGNOUT, visibleItems);
	return (
		<div className="w-full max-w-4xl p-6">
			<div className="mb-8 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="text-xl font-semibold">Account</h2>
					<p className="mt-1 max-w-lg text-sm text-muted-foreground">
						Connect GatedSpace and manage the agents on this computer. Your
						projects stay available when you are signed out.
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={openFirstRunSetup}>
					Getting started
				</Button>
			</div>
			{showAccount && <SyncSettings title="GatedSpace account" />}
			{showProfile && (
				<section
					aria-labelledby="account-agents-title"
					className="mt-8 space-y-3"
				>
					<h3 id="account-agents-title" className="text-base font-semibold">
						Agent accounts
					</h3>
					<p className="max-w-lg text-sm text-muted-foreground">
						Claude Code and Codex each use their own sign-in and subscription.
						You can connect them and open a workspace with or without a
						GatedSpace account.
					</p>
					<AgentSetup agent="claude" />
					<AgentSetup agent="codex" />
				</section>
			)}
		</div>
	);
}
