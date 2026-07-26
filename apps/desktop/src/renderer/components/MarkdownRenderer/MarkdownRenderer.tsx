import { cn } from "@superset/ui/utils";
import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useMarkdownStyle } from "renderer/stores";
import { SelectionContextMenu } from "./components";
import { remarkHardBreaks } from "./remark-hard-breaks";
import { defaultConfig } from "./styles/default/config";
import { tufteConfig } from "./styles/tufte/config";

const styleConfigs = {
	default: defaultConfig,
	tufte: tufteConfig,
} as const;

interface MarkdownRendererProps {
	content: string;
	style?: keyof typeof styleConfigs;
	className?: string;
	/**
	 * Render a single newline as a line break instead of a space.
	 *
	 * Off by default, because documents are written as markdown and expect the
	 * standard rule. Turn it on for text that only passes THROUGH markdown — chat
	 * output, CLI results — where the newlines were meant literally.
	 */
	breaks?: boolean;
}

export function MarkdownRenderer({
	content,
	style: styleProp,
	className,
	breaks,
}: MarkdownRendererProps) {
	const globalStyle = useMarkdownStyle();
	const style = styleProp ?? globalStyle;
	const config = styleConfigs[style];
	const articleRef = useRef<HTMLElement | null>(null);
	const remarkPlugins = breaks ? [remarkGfm, remarkHardBreaks] : [remarkGfm];

	return (
		<SelectionContextMenu selectAllContainerRef={articleRef}>
			<div
				className={cn(
					"markdown-renderer h-full overflow-y-auto select-text",
					config.wrapperClass,
					className,
				)}
			>
				<article ref={articleRef} className={config.articleClass}>
					<ReactMarkdown
						remarkPlugins={remarkPlugins}
						rehypePlugins={[rehypeRaw, rehypeSanitize]}
						components={config.components}
					>
						{content}
					</ReactMarkdown>
				</article>
			</div>
		</SelectionContextMenu>
	);
}
