import { join } from "node:path";
import { SUPERSET_HOME_DIR } from "../app-environment";
import { ensureSecureDir } from "../secure-file";
import { LocalPreviewStore } from "./local-preview-store";

let store: LocalPreviewStore | undefined;
export function localPreviews() {
	if (!store) {
		const directory = join(SUPERSET_HOME_DIR, "browser-previews");
		ensureSecureDir(directory);
		store = new LocalPreviewStore(directory);
	}
	return store;
}
