import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import type { ProjectField, ProjectTableRow } from "@/server/projects";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

function RowTitle({ row }: { row: ProjectTableRow }) {
	if (row.kind === "draft") {
		return (
			<div className="min-w-0 space-y-1">
				<p className="font-medium text-bjork-text">{row.title}</p>
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

export function ProjectTable({
	fields,
	rows,
	emptyMessage,
}: {
	fields: ProjectField[];
	rows: ProjectTableRow[];
	emptyMessage: string;
}) {
	if (rows.length === 0) {
		return (
			<p className="px-5 py-10 text-sm text-bjork-text-soft">{emptyMessage}</p>
		);
	}
	return (
		<div className="overflow-x-auto rounded-[18px] border border-bjork-border-muted bg-bjork-surface">
			<table className="w-full min-w-[640px] border-collapse text-sm">
				<thead>
					<tr className="border-b border-bjork-border-muted text-left text-xs text-bjork-text-soft">
						<th scope="col" className="px-4 py-3 font-medium">
							Title
						</th>
						{fields.map((field) => (
							<th
								key={field.name}
								scope="col"
								className="px-4 py-3 font-medium whitespace-nowrap"
							>
								{field.name}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.id}
							className="border-b border-bjork-border-muted align-top last:border-0"
						>
							<td className="px-4 py-3">
								<RowTitle row={row} />
							</td>
							{fields.map((field) => {
								const value = row.values[field.name.toLowerCase()];
								return (
									<td
										key={field.name}
										className="px-4 py-3 text-bjork-text-medium"
									>
										{value ?? <span className="text-bjork-text-soft">—</span>}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
