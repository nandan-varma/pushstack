import { Link, useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import type { ProjectField } from "@/server/projects";

/** The URL state the toolbar owns; the route's search carries it. */
export interface ProjectViewSearch {
	view?: "board";
	q?: string;
	sort?: string;
	dir?: "asc" | "desc";
	group?: string;
	by?: string;
}

/**
 * The table/board switch and the board's sort, group and secondary-field
 * controls. Every choice is a URL search param, so a link restores the view.
 */
export function ProjectBoardToolbar({
	login,
	number,
	view,
	search,
	fields,
	itemCount,
	truncated,
}: {
	login: string;
	number: number;
	view: "table" | "board";
	search: ProjectViewSearch;
	fields: ProjectField[];
	itemCount: number;
	truncated: boolean;
}) {
	const navigate = useNavigate({ from: "/users/$login/projects/$number" });
	const go = (next: ProjectViewSearch) => {
		const merged = { ...search, ...next };
		navigate({
			to: "/users/$login/projects/$number",
			params: { login, number: String(number) },
			search: Object.fromEntries(
				Object.entries(merged).filter(([, value]) => value !== undefined),
			),
			replace: true,
		});
	};
	const selects = fields.filter((field) => field.dataType === "SINGLE_SELECT");
	const sortable = fields.filter(
		(field) => field.dataType === "NUMBER" || field.dataType === "DATE",
	);
	const group = search.group ?? selects[0]?.name ?? "Status";
	const sort = search.sort ?? "title";
	const dir = search.dir ?? "asc";
	const by = search.by ?? "";
	const link = (next: ProjectViewSearch) => ({
		to: "/users/$login/projects/$number" as const,
		params: { login, number: String(number) },
		search: Object.fromEntries(
			Object.entries({ ...search, ...next }).filter(
				([, value]) => value !== undefined,
			),
		),
	});

	return (
		<div className="flex flex-wrap items-center gap-3 text-sm">
			<nav aria-label="Project view" className="flex gap-1">
				<Link
					{...link({ view: undefined })}
					className={`rounded-[13px] px-3 py-1.5 ${
						view === "table"
							? "bg-bjork-accent/10 font-medium text-bjork-accent"
							: "text-bjork-text-medium hover:text-bjork-text"
					}`}
				>
					Table
				</Link>
				<Link
					{...link({ view: "board" })}
					className={`rounded-[13px] px-3 py-1.5 ${
						view === "board"
							? "bg-bjork-accent/10 font-medium text-bjork-accent"
							: "text-bjork-text-medium hover:text-bjork-text"
					}`}
				>
					Board
				</Link>
			</nav>
			{view === "board" && (
				<>
					<label className="flex items-center gap-1.5">
						<span className="text-bjork-text-soft">Group</span>
						<select
							aria-label="Group by"
							value={group}
							onChange={(event) => go({ group: event.target.value })}
							className="rounded-lg border border-bjork-border-muted bg-bjork-surface px-2 py-1"
						>
							{selects.map((field) => (
								<option key={field.id} value={field.name}>
									{field.name}
								</option>
							))}
						</select>
					</label>
					<label className="flex items-center gap-1.5">
						<span className="text-bjork-text-soft">Sort</span>
						<select
							aria-label="Sort by"
							value={sort}
							onChange={(event) => go({ sort: event.target.value })}
							className="rounded-lg border border-bjork-border-muted bg-bjork-surface px-2 py-1"
						>
							<option value="title">Title</option>
							<option value="updated">Updated</option>
							{sortable.map((field) => (
								<option key={field.id} value={field.name.toLowerCase()}>
									{field.name}
								</option>
							))}
						</select>
					</label>
					<button
						type="button"
						aria-label={`Sort ${dir === "asc" ? "descending" : "ascending"}`}
						className="text-bjork-text-medium hover:text-bjork-text"
						onClick={() => go({ dir: dir === "asc" ? "desc" : "asc" })}
					>
						{dir === "asc" ? "Ascending" : "Descending"}
					</button>
					<label className="flex items-center gap-1.5">
						<span className="text-bjork-text-soft">Field on cards</span>
						<select
							aria-label="Secondary field"
							value={by}
							onChange={(event) => go({ by: event.target.value })}
							className="rounded-lg border border-bjork-border-muted bg-bjork-surface px-2 py-1"
						>
							<option value="">None</option>
							{fields
								.filter(
									(field) => field.name.toLowerCase() !== group.toLowerCase(),
								)
								.map((field) => (
									<option key={field.id} value={field.name.toLowerCase()}>
										{field.name}
									</option>
								))}
						</select>
					</label>
					{truncated && (
						<Badge variant="outline">Showing the first {itemCount}</Badge>
					)}
				</>
			)}
		</div>
	);
}
