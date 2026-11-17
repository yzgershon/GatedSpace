import { toast } from "@superset/ui/sonner";
import type { ReactNode } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { localFilePath } from "../../file-links";

export function MarkdownLink({
	href,
	children,
	className,
}: {
	href?: string;
	children?: ReactNode;
	className?: string;
}) {
	const file = href && /^file:/i.test(href) ? localFilePath(href) : null;
	return (
		<a
			href={href || undefined}
			className={
				className ??
				"text-primary underline underline-offset-2 hover:text-primary/80"
			}
			target="_blank"
			rel="noopener noreferrer"
			onClick={
				file
					? (event) => {
							event.preventDefault();
							event.stopPropagation();
							void electronTrpcClient.external.openLocalFile
								.mutate(file)
								.catch((error) => {
									toast.error("Could not open this file", {
										description:
											error instanceof Error ? error.message : String(error),
									});
								});
						}
					: undefined
			}
		>
			{children}
		</a>
	);
}
