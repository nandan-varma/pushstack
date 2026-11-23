import { Link } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { lazy, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import type { ProjectTableRow } from "@/server/projects";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

export function ProjectItemTitle({
	row,
	canWrite,
	onEditDraft,
}: {
	row: ProjectTableRow;
	canWrite: boolean;
	onEditDraft?: (row: ProjectTableRow) => void;
}) {
	if (row.kind === "draft") {
		return (
			<div className="min-w-0 space-y-1">
				<p className="flex items-center gap-1.5 font-medium text-bjork-text">
					{canWrite && onEditDraft ? (
						<button
							type="button"
							className="text-left hover:text-bjork-accent"
							onClick={() => onEditDraft(row)}
						>
							{row.title}
						</button>
					) : (
						<Dialog>
							<DialogTrigger
								render={
									<button
										type="button"
										className="text-left hover:text-bjork-accent"
									/>
								}
							>
								{row.title}
							</DialogTrigger>
							<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
								<DialogHeader>
									<DialogTitle>{row.title}</DialogTitle>
								</DialogHeader>
								{row.body ? (
									<Suspense fallback={<p>Loading description…</p>}>
										<MarkdownRenderer content={row.body} />
									</Suspense>
								) : (
									<p className="text-sm text-bjork-text-muted">
										No description.
									</p>
								)}
							</DialogContent>
						</Dialog>
					)}
					{canWrite && onEditDraft && (
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label={`Edit draft ${row.title}`}
							onClick={() => onEditDraft(row)}
						>
							<Pencil aria-hidden="true" />
						</Button>
					)}
				</p>
				{row.body && (
					<div className="line-clamp-2 text-sm text-bjork-text-medium">
						<Suspense fallback={null}>
							<MarkdownRenderer content={row.body} />
						</Suspense>
					</div>
				)}
			</div>
		);
	}
	if (!row.repoOwner || !row.repoName || row.number === null) {
		return <span className="text-bjork-text-soft">—</span>;
	}
	const params = {
		owner: row.repoOwner,
		name: row.repoName,
		id: String(row.number),
	};
	const label = `${row.repoOwner}/${row.repoName}#${row.number}`;
	return (
		<div className="min-w-0 space-y-0.5">
			{row.kind === "pull_request" ? (
				<Link
					to="/$owner/$name/pull/$id/{-$tab}"
					params={params}
					className="font-medium text-bjork-text hover:text-bjork-accent"
				>
					{row.title}
				</Link>
			) : (
				<Link
					to="/$owner/$name/issues/$id"
					params={params}
					className="font-medium text-bjork-text hover:text-bjork-accent"
				>
					{row.title}
				</Link>
			)}
			<p className="flex items-center gap-1.5 text-xs text-bjork-text-soft">
				<Badge variant="outline">
					{row.kind === "pull_request" ? "Pull request" : "Issue"}
				</Badge>
				<span className="font-mono">{label}</span>
			</p>
		</div>
	);
}
