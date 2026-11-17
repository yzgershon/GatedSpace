import { defaultUrlTransform } from "react-markdown";
import { defaultSchema } from "rehype-sanitize";

interface TreeNode {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: TreeNode[];
}

/** Local disk links only. Never turn a network share into a clickable file URL. */
export function localFilePath(href: string): string | null {
	let path = href;
	if (/^file:/i.test(path)) {
		try {
			const url = new URL(path);
			if (url.hostname && url.hostname !== "localhost") return null;
			path = decodeURIComponent(url.pathname);
		} catch {
			return null;
		}
	} else {
		try {
			path = decodeURIComponent(path);
		} catch {
			return null;
		}
	}
	path = path.replaceAll("\\", "/");
	if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in paths before handing them to the OS.
	if (path.startsWith("//") || /[\u0000-\u001f]/.test(path)) return null;
	if (!/^[a-z]:\//i.test(path) && !path.startsWith("/")) return null;
	// Assistant file citations append source coordinates, not part of the filename.
	return path.replace(/:\d+(?::\d+)?$/, "").replace(/#L\d+(?:C\d+)?$/, "");
}

export function localFileHref(href: string): string | null {
	const path = localFilePath(href);
	if (!path) return null;
	return `file://${path.startsWith("/") ? "" : "/"}${path
		.split("/")
		.map(encodeURIComponent)
		.join("/")
		.replace(/^([a-z])%3A/i, "$1:")}`;
}

/** Runs before sanitizing: Windows drive letters otherwise look like URI schemes. */
export function rehypeLocalFileLinks() {
	return (tree: TreeNode) => {
		const visit = (node: TreeNode) => {
			if (
				node.type === "element" &&
				node.tagName === "a" &&
				typeof node.properties?.href === "string"
			) {
				const href = localFileHref(node.properties.href);
				if (href) node.properties.href = href;
			}
			if (node.children) for (const child of node.children) visit(child);
		};
		visit(tree);
	};
}

export const fileLinkSchema = {
	...defaultSchema,
	protocols: {
		...defaultSchema.protocols,
		href: [...(defaultSchema.protocols?.href ?? []), "file"],
	},
};

export const markdownUrlTransform: typeof defaultUrlTransform = (url) => {
	if (/^file:/i.test(url)) return localFileHref(url) ?? "";
	// Protocol-relative URLs and UNC spellings can trigger Windows network authentication.
	if (/^[\\/]{2}/.test(url)) return "";
	return defaultUrlTransform(url);
};
