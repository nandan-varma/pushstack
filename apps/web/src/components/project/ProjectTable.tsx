import { Link } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type {
	ProjectField,
	ProjectFieldValueInput,
	ProjectTableRow,
} from "@/server/projects";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

const NO_OPTION = "none";

function RowTitle({
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
					{row.title}
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

/**
 * A cell's edit controls: the field's own type decides the input, and the
 * current display value seeds it. A select sends the option's id, so the
 * server's type check is never bypassed by an optimistic write.
 */
function CellEditor({
	row,
	field,
	value,
	pending,
	onSave,
	onClear,
}: {
	row: ProjectTableRow;
	field: ProjectField;
	value: string | null;
	pending: boolean;
	onSave: (input: ProjectFieldValueInput) => void;
	onClear: () => void;
}) {
	const [draft, setDraft] = useState(value ?? "");
	const save = () => {
		if (field.dataType === "TEXT") {
			if (draft.trim()) onSave({ type: "TEXT", text: draft });
		} else if (field.dataType === "NUMBER") {
			const parsed = Number(draft);
			if (draft !== "" && Number.isFinite(parsed))
				onSave({ type: "NUMBER", number: parsed });
		} else if (field.dataType === "DATE") {
			if (draft) onSave({ type: "DATE", date: draft });
		}
	};

	if (field.dataType === "SINGLE_SELECT") {
		const selected = field.options.find((option) => option.name === value);
		return (
			<Select
				value={selected?.id ?? NO_OPTION}
				onValueChange={(optionId) => {
					if (optionId === NO_OPTION) {
						if (selected) onClear();
						return;
					}
					const option = field.options.find(
						(candidate) => candidate.id === optionId,
					);
					if (option) onSave({ type: "SINGLE_SELECT", optionId });
				}}
			>
				<SelectTrigger
					aria-label={`Set ${field.name} for ${row.title}`}
					className="h-8 w-40"
				>
					<SelectValue placeholder="—" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={NO_OPTION}>None</SelectItem>
					{field.options.map((option) => (
						<SelectItem key={option.id} value={option.id}>
							{option.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}
	return (
		<div className="flex items-center gap-1.5">
			<Input
				aria-label={`Set ${field.name} for ${row.title}`}
				className="h-8 w-36"
				type={
					field.dataType === "NUMBER"
						? "number"
						: field.dataType === "DATE"
							? "date"
							: "text"
				}
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
			/>
			<Button size="sm" disabled={pending || !draft} onClick={save}>
				Save
			</Button>
			{value !== null && (
				<Button size="sm" variant="ghost" disabled={pending} onClick={onClear}>
					Clear
				</Button>
			)}
		</div>
	);
}

export function ProjectTable({
	fields,
	rows,
	emptyMessage,
	canWrite = false,
	pending = false,
	onSetValue,
	onClearValue,
	onEditDraft,
}: {
	fields: ProjectField[];
	rows: ProjectTableRow[];
	emptyMessage: string;
	canWrite?: boolean;
	pending?: boolean;
	onSetValue?: (
		itemId: number,
		field: ProjectField,
		input: ProjectFieldValueInput,
	) => void;
	onClearValue?: (itemId: number, field: ProjectField) => void;
	onEditDraft?: (row: ProjectTableRow) => void;
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
								<RowTitle
									row={row}
									canWrite={canWrite}
									onEditDraft={onEditDraft}
								/>
							</td>
							{fields.map((field) => {
								const value = row.values[field.name.toLowerCase()];
								const editable = canWrite && onSetValue !== undefined;
								return (
									<td
										key={field.name}
										className="px-4 py-3 text-bjork-text-medium"
									>
										{editable ? (
											<CellEditor
												row={row}
												field={field}
												value={value}
												pending={pending}
												onSave={(input) => onSetValue?.(row.id, field, input)}
												onClear={() => onClearValue?.(row.id, field)}
											/>
										) : (
											(value ?? <span className="text-bjork-text-soft">—</span>)
										)}
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
