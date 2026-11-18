import { lazy, Suspense, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CodeViewer = lazy(() => import("@/components/CodeViewer"));

export interface GistFile {
	path: string;
	size: number;
	truncated: boolean;
	language: string | null;
	content: string | null;
}

/** `/{owner}/{id}/raw/{revision}/{path}` on the page's own origin. */
export function gistRawFileUrl(
	owner: string,
	id: string,
	revision: string,
	path: string,
): string {
	return `/gist/${[owner, id, "raw", revision, ...path.split("/")].map(encodeURIComponent).join("/")}`;
}

/** A gist's files as GitHub shows them: one tab per file, the selected file's source. */
export function GistFileViewer({
	owner,
	id,
	revision,
	files,
}: {
	owner: string;
	id: string;
	revision: string;
	files: readonly GistFile[];
}) {
	const [selected, setSelected] = useState(files[0]?.path ?? "");
	const file =
		files.find((candidate) => candidate.path === selected) ?? files[0];
	if (!file) return null;
	return (
		<div className="overflow-hidden rounded-[18px] border border-bjork-border-muted bg-bjork-surface shadow-(--bjork-shadow-surface)">
			<div className="flex items-center gap-1 overflow-x-auto border-b border-bjork-border-muted bg-bjork-surface-muted px-2 py-1.5">
				{files.map((candidate) => (
					<button
						key={candidate.path}
						type="button"
						onClick={() => setSelected(candidate.path)}
						aria-current={candidate.path === file.path}
						className={cn(
							"shrink-0 rounded-md px-2.5 py-1 font-mono text-xs transition-colors",
							candidate.path === file.path
								? "bg-bjork-surface text-bjork-text shadow-(--bjork-shadow-soft)"
								: "text-bjork-text-muted hover:bg-bjork-surface-hover hover:text-bjork-text",
						)}
					>
						{candidate.path}
					</button>
				))}
				<a
					href={gistRawFileUrl(owner, id, revision, file.path)}
					className="ml-auto shrink-0 px-2 text-xs text-bjork-text-muted hover:text-bjork-text"
				>
					Raw
				</a>
			</div>
			{file.content === null ? (
				<p className="px-5 py-4 text-sm text-bjork-text-muted">
					This file is too large to display here ({file.size} bytes).{" "}
					<a
						href={gistRawFileUrl(owner, id, revision, file.path)}
						className="underline"
					>
						View raw
					</a>
				</p>
			) : (
				<Suspense fallback={<Skeleton className="h-40" />}>
					<CodeViewer
						code={file.content}
						language={file.language ?? "plaintext"}
					/>
				</Suspense>
			)}
		</div>
	);
}
