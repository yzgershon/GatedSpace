import { useRef, useState } from "react";
import { FlowMicrophone } from "../../src/renderer/components/SessionComposerControls/FlowMicrophone/FlowMicrophone";

export function DictationFixture() {
	const [text, setText] = useState("Keep this draft");
	const [error, setError] = useState("");
	const textarea = useRef<HTMLTextAreaElement>(null);
	return (
		<section data-testid="dictation" style={{ padding: 24 }}>
			<textarea
				ref={textarea}
				value={text}
				onChange={(event) => setText(event.target.value)}
				aria-label="Dictation draft"
			/>
			<FlowMicrophone
				paneId="fixture"
				textarea={textarea}
				onText={setText}
				onError={setError}
			/>
			<output>{error}</output>
		</section>
	);
}
