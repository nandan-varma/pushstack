import type { ReactNode } from "react";
import { FileTreePane } from "./FileTreePane";

/**
 * The code view's frame: the file tree in a sticky pane on wide screens, the
 * page's content beside it. Phones get the content alone; the breadcrumb is
 * their way around.
 */
export function CodeWorkbench({
	owner,
	name,
	repoId,
	gitRef,
	activePath,
	kind,
	children,
}: {
	owner: string;
	name: string;
	repoId: number;
	gitRef: string;
	activePath: string;
	kind: "tree" | "blob";
	children: ReactNode;
}) {
	return (
		<div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
			<aside className="sticky top-6 hidden max-h-[calc(100vh-3rem)] overflow-hidden rounded-[18px] border border-bjork-border-muted bg-bjork-surface shadow-(--bjork-shadow-surface) lg:flex lg:flex-col">
				<FileTreePane
					owner={owner}
					name={name}
					repoId={repoId}
					gitRef={gitRef}
					activePath={activePath}
					kind={kind}
				/>
			</aside>
			<div className="min-w-0 space-y-4">{children}</div>
		</div>
	);
}
