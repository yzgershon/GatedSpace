import { digest } from "@superset/shared/continuity/crypto";
import { get, put } from "@vercel/blob";
import type { BlobStorage } from "./http";

const path = (ownerId: string, id: string) => `v1/${digest(ownerId)}/${id}`;
export const privateBlobs: BlobStorage = {
	async put(ownerId, id, data) {
		// The API verifies SHA-256 before this call. A retry at the same path can
		// only write the same bytes, including when two uploads finish together.
		await put(path(ownerId, id), Buffer.from(data), {
			access: "private",
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: "application/octet-stream",
		});
	},
	async get(ownerId, id) {
		const result = await get(path(ownerId, id), {
			access: "private",
			useCache: false,
		});
		return result?.statusCode === 200 ? result.stream : null;
	},
};
