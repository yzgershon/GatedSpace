import type { ClaudePermissionRequest } from "shared/claude-session/events";
import { SessionPermissionRequest } from "./components/SessionPermissionRequest";

export function SessionPermissionRequests({
	sessionKey,
	requests,
}: {
	sessionKey: string;
	requests: ClaudePermissionRequest[];
}) {
	if (!requests.length) return null;
	return (
		<div className="mx-auto w-full min-w-0 max-w-[960px] space-y-3 px-4 py-4 sm:px-6">
			{requests.map((request) => (
				<SessionPermissionRequest
					key={`${sessionKey}:${request.id}`}
					sessionKey={sessionKey}
					request={request}
				/>
			))}
		</div>
	);
}
