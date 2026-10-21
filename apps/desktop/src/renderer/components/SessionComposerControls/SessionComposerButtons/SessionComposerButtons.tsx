import { SessionComposerSettings } from "../SessionComposerSettings";

export function SessionComposerButtons(
	props: Parameters<typeof SessionComposerSettings>[0],
) {
	return (
		<div className="session-composer-buttons">
			<SessionComposerSettings {...props} section="model" />
			<SessionComposerSettings {...props} section="permissions" />
		</div>
	);
}
