/** Successful edits for one task, never a workspace-wide Git status. */
export interface SessionChangeSummary {
	files: number;
	added: number | null;
	removed: number | null;
}

export interface SessionFileChange {
	path: string;
	added: number | null;
	removed: number | null;
}
