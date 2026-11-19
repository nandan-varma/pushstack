import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type {
	ProjectField,
	ProjectFieldValueInput,
	ProjectTableRow,
} from "@/server/projects";

/**
 * The board: one column per option of the group-by single-select field, a card
 * per item with its title and the chosen secondary field. Dragging a card to
 * another column sets the group field to that option (by id, so the server's
 * type check still applies); dropping it on "No <field>" clears it.
 */
export function ProjectBoard({
	fields,
	rows,
	group,
	by,
	canWrite,
	pending,
	onSetValue,
	onClearValue,
	onEditDraft,
}: {
	fields: ProjectField[];
	rows: ProjectTableRow[];
	group: string;
	by: string;
	canWrite: boolean;
	pending: boolean;
	onSetValue: (
		itemId: number,
		field: ProjectField,
		input: ProjectFieldValueInput,
	) => void;
	onClearValue: (itemId: number, field: ProjectField) => void;
	onEditDraft?: (row: ProjectTableRow) => void;
}) {
	const [dragged, setDragged] = useState<ProjectTableRow | null>(null);
	const field = fields.find(
		(candidate) => candidate.name.toLowerCase() === group.toLowerCase(),
	);
	if (field?.dataType !== "SINGLE_SELECT") {
		return (
			<p className="px-5 py-10 text-sm text-bjork-text-soft">
				No single-select field named "{group}" to group by.
			</p>
		);
	}
	const secondary =
		fields.find((candidate) => candidate.name.toLowerCase() === by) ?? null;
	const columns = [
		...field.options.map((option) => ({
			id: option.id,
			name: option.name,
			rows: rows.filter(
				(row) => row.values[field.name.toLowerCase()] === option.name,
			),
		})),
		{
			id: "none",
			name: `No ${field.name}`,
			rows: rows.filter((row) => !row.values[field.name.toLowerCase()]),
		},
	];
	const drop = (column: { id: string; name: string }) => {
		const item = dragged;
		setDragged(null);
		if (!item || pending) return;
		if (column.id === "none") onClearValue(item.id, field);
		else {
			const option = field.options.find((entry) => entry.id === column.id);
			if (option)
				onSetValue(item.id, field, {
					type: "SINGLE_SELECT",
					optionId: option.id,
				});
		}
	};

	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-4">
			{columns.map((column) => (
				<section
					key={column.id}
					aria-label={`${field.name}: ${column.name}`}
					onDragOver={(event) => canWrite && event.preventDefault()}
					onDrop={(event) => {
						event.preventDefault();
						if (canWrite) drop(column);
					}}
					className="min-h-40 rounded-[18px] border border-bjork-border-muted bg-bjork-surface p-3"
				>
					<header className="mb-2 flex items-center justify-between text-xs text-bjork-text-soft">
						<span className="font-medium">{column.name}</span>
						<span>{column.rows.length}</span>
					</header>
					<ul className="space-y-2">
						{column.rows.map((row) => (
							<li key={row.id}>
								<article
									draggable={canWrite}
									onDragStart={() => setDragged(row)}
									aria-label={`${row.title} in ${column.name}`}
									className="space-y-1.5 rounded-xl border border-bjork-border-muted bg-bjork-surface p-3 text-sm shadow-[var(--bjork-shadow-soft)]"
								>
									<button
										type="button"
										className="text-left font-medium text-bjork-text hover:text-bjork-accent"
										onClick={() => {
											if (row.kind === "draft") onEditDraft?.(row);
										}}
									>
										{row.title}
									</button>
									<div className="flex items-center gap-1.5">
										<Badge variant="outline">
											{row.kind === "pull_request"
												? "Pull request"
												: row.kind === "issue"
													? "Issue"
													: "Draft"}
										</Badge>
										{row.repoOwner && row.repoName && row.number !== null && (
											<span className="font-mono text-xs text-bjork-text-soft">
												{row.repoOwner}/{row.repoName}#{row.number}
											</span>
										)}
									</div>
									{secondary && (
										<p className="text-xs text-bjork-text-medium">
											{secondary.name}:{" "}
											{row.values[secondary.name.toLowerCase()] ?? "—"}
										</p>
									)}
								</article>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
