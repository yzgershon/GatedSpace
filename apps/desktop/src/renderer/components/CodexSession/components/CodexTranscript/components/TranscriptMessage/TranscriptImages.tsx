import { useEffect, useState } from "react";
import { ComposerImage } from "renderer/components/SessionComposerControls/ComposerImage";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { CodexItem } from "shared/codex-session/types";

function LocalImage({
	sessionKey,
	itemId,
	path,
	index,
}: {
	sessionKey: string;
	itemId: string;
	path: string;
	index: number;
}) {
	const [image, setImage] = useState<{ source: string; name: string }>();
	const [error, setError] = useState("");
	useEffect(() => {
		let cancelled = false;
		void electronTrpcClient.codexSession.attachment
			.query({ key: sessionKey, itemId, index })
			.then((value) => {
				if (!cancelled) setImage(value);
			})
			.catch(() => {
				if (!cancelled)
					setError("Image is no longer available on this computer.");
			});
		return () => {
			cancelled = true;
		};
	}, [sessionKey, itemId, index]);
	return image ? (
		<ComposerImage {...image} />
	) : (
		<span className="codex-image-unavailable" title={error}>
			{path.split(/[\\/]/).at(-1)} · {error ? "Unavailable" : "Loading image…"}
		</span>
	);
}

export function TranscriptImages({
	item,
	sessionKey,
	limit,
}: {
	item: CodexItem;
	sessionKey?: string;
	limit?: number;
}) {
	if (!item.images?.length && !item.imagePaths?.length) return null;
	return (
		<div className="codex-message-images">
			{item.images?.slice(0, limit).map((source, index) => (
				<ComposerImage
					key={`${index}:${source.slice(-60)}`}
					name={`Image ${index + 1}`}
					source={source}
				/>
			))}
			{sessionKey &&
				item.imagePaths
					?.slice(
						0,
						limit === undefined
							? undefined
							: Math.max(0, limit - (item.images?.length ?? 0)),
					)
					.map((path, index) => (
						<LocalImage
							// biome-ignore lint/suspicious/noArrayIndexKey: immutable ordered attachments may contain the same path twice.
							key={`${path}:${index}`}
							sessionKey={sessionKey}
							itemId={item.id}
							path={path}
							index={index}
						/>
					))}
		</div>
	);
}
