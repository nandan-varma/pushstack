import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/layout/page";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PageHeader } from "@/components/PageHeader";
import { ProjectDraftDialog } from "@/components/project/ProjectDraftDialog";
import { ProjectFieldEditor } from "@/components/project/ProjectFieldEditor";
import { ProjectItemPicker } from "@/components/project/ProjectItemPicker";
import { ProjectTable } from "@/components/project/ProjectTable";
import { ThreadSearchBox } from "@/components/ThreadSearchBox";
import { useToast } from "@/components/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
	MAX_PROJECT_BOARD_ITEMS,
	MAX_PROJECT_FILTER_CHARS,
} from "@/lib/limits";
import {
	projectAddableItemsQueryOptions,
	queryKeys,
	userProjectQueryOptions,
} from "@/lib/query-options";
import type {
	ProjectFieldValueInput,
	ProjectTableRow,
} from "@/server/projects";
import {
	addUserProjectItem,
	clearUserProjectItemFieldValue,
	setUserProjectItemFieldValue,
	updateUserProjectDraft,
} from "@/server/projects";

export const Route = createFileRoute("/users/$login/projects/$number")({
	validateSearch: (
		search: Record<string, unknown>,
	): { q?: string; page?: number } => ({
		q:
			typeof search.q === "string" && search.q
				? search.q.slice(0, MAX_PROJECT_FILTER_CHARS)
				: undefined,
		page:
			typeof search.page === "number" && search.page > 1
				? Math.floor(search.page)
				: undefined,
	}),
	loaderDeps: ({ search }) => ({ q: search.q ?? "", page: search.page ?? 1 }),
	loader: ({ params, deps, context: { queryClient } }) => {
		const number = Number(params.number);
		if (!Number.isInteger(number) || number < 1) throw notFound();
		return queryClient.ensureQueryData(
			userProjectQueryOptions(params.login, number, deps.q, deps.page),
		);
	},
	component: ProjectPage,
	notFoundComponent: ProjectNotFound,
});

function ProjectNotFound() {
	const { login } = Route.useParams();
	return (
		<Page>
			<NotFoundCard
				title="Project not found"
				message="This project does not exist or you do not have access to it."
				backTo="/users/$login/projects"
				backParams={{ login }}
				backLabel="Back to projects"
			/>
		</Page>
	);
}

const EMPTY_DRAFT = { title: "", body: null };

function ProjectPage() {
	const { login, number } = Route.useParams();
	const { q, page } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data, isLoading } = useQuery(
		userProjectQueryOptions(login, Number(number), q ?? "", page ?? 1),
	);
	const [pickerQuery, setPickerQuery] = useState("");
	const [draftForm, setDraftForm] = useState<{
		open: boolean;
		itemId: number | null;
		initial: { title: string; body: string | null };
	}>({ open: false, itemId: null, initial: EMPTY_DRAFT });

	const invalidateProject = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.userProjectRoot(login, Number(number)),
		});
	const writeError = (error: Error, fallback: string) =>
		toast(error.message || fallback, "error");

	const addItem = useMutation({
		mutationFn: addUserProjectItem,
		onSuccess: () => {
			invalidateProject();
			toast("Item added", "success");
		},
		onError: (error: Error) => writeError(error, "Couldn't add the item"),
	});
	const addDraft = useMutation({
		mutationFn: addUserProjectItem,
		onSuccess: () => {
			setDraftForm({ open: false, itemId: null, initial: EMPTY_DRAFT });
			invalidateProject();
		},
		onError: (error: Error) => writeError(error, "Couldn't add the draft"),
	});
	const updateDraft = useMutation({
		mutationFn: updateUserProjectDraft,
		onSuccess: () => {
			setDraftForm({ open: false, itemId: null, initial: EMPTY_DRAFT });
			invalidateProject();
		},
		onError: (error: Error) => writeError(error, "Couldn't edit the draft"),
	});
	const setValue = useMutation({
		mutationFn: setUserProjectItemFieldValue,
		onSuccess: invalidateProject,
		onError: (error: Error) => writeError(error, "Couldn't set the value"),
	});
	const clearValue = useMutation({
		mutationFn: clearUserProjectItemFieldValue,
		onSuccess: invalidateProject,
		onError: (error: Error) => writeError(error, "Couldn't clear the value"),
	});

	const addable = useQuery(
		projectAddableItemsQueryOptions(login, Number(number), pickerQuery),
	);

	if (isLoading || !data) {
		return (
			<Page className="space-y-4">
				<Skeleton className="h-9 w-64" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-64" />
			</Page>
		);
	}

	const { project } = data;
	const setFilter = (next: string) =>
		navigate({ search: { q: next || undefined }, replace: true });
	const pageLink = (target: number) => ({
		to: "/users/$login/projects/$number" as const,
		params: { login, number },
		search: { q: q || undefined, page: target > 1 ? target : undefined },
	});
	const canWrite = data.canWrite && !project.closed;
	const submitDraft = (draft: { title: string; body: string | null }) => {
		if (draftForm.itemId === null) {
			addDraft.mutate({
				data: {
					login,
					number: Number(number),
					draftTitle: draft.title,
					draftBody: draft.body,
				},
			});
		} else {
			updateDraft.mutate({
				data: {
					login,
					number: Number(number),
					itemId: draftForm.itemId,
					title: draft.title,
					body: draft.body,
				},
			});
		}
	};
	const onSetValue = (
		itemId: number,
		field: { id: number; dataType: ProjectFieldValueInput["type"] },
		input: ProjectFieldValueInput,
	) =>
		setValue.mutate({
			data: {
				login,
				number: Number(number),
				itemId,
				fieldId: field.id,
				value: input,
			},
		});
	const onClearValue = (itemId: number, field: { id: number }) =>
		clearValue.mutate({
			data: { login, number: Number(number), itemId, fieldId: field.id },
		});
	const onEditDraft = (row: ProjectTableRow) =>
		setDraftForm({
			open: true,
			itemId: row.id,
			initial: { title: row.title, body: row.body },
		});

	return (
		<Page className="space-y-5">
			<PageHeader
				title={project.title}
				meta={`#${project.number}`}
				description={
					<>
						<Link
							to="/$owner"
							params={{ owner: project.ownerLogin }}
							className="text-bjork-accent hover:underline"
						>
							{project.ownerLogin}
						</Link>{" "}
						· {project.public ? "Public" : "Private"}
						{project.closed && " · Closed"} ·{" "}
						{data.itemCount === 1 ? "1 item" : `${data.itemCount} items`}
					</>
				}
				actions={
					<>
						<Badge variant="outline">
							{project.closed ? "Closed" : "Open"}
						</Badge>
						<Badge variant={project.public ? "outline" : "secondary"}>
							{project.public ? "Public" : "Private"}
						</Badge>
						{canWrite && (
							<span className="flex items-center gap-2">
								<ProjectItemPicker
									login={login}
									number={Number(number)}
									itemCount={data.itemCount}
									pending={addItem.isPending}
									results={addable.data?.items ?? []}
									onSearch={setPickerQuery}
									onAdd={(issueId) =>
										addItem.mutate({
											data: {
												login,
												number: Number(number),
												issueId,
											},
										})
									}
								/>
								<button
									type="button"
									className="inline-flex items-center gap-1 rounded-[13px] border border-bjork-border-muted px-3 py-1.5 text-sm text-bjork-text-medium hover:text-bjork-text"
									onClick={() =>
										setDraftForm({
											open: true,
											itemId: null,
											initial: EMPTY_DRAFT,
										})
									}
								>
									<Plus aria-hidden="true" className="size-4" />
									Add draft
								</button>
							</span>
						)}
					</>
				}
			/>
			{project.shortDescription && (
				<p className="text-sm text-bjork-text-medium">
					{project.shortDescription}
				</p>
			)}
			<ThreadSearchBox
				value={q ?? ""}
				onSearch={setFilter}
				placeholder="Filter by title, is:issue, is:pr, is:draft or status:Todo"
				ariaLabel="Filter project items"
			/>
			{data.truncated && (
				<p className="text-xs text-bjork-text-soft">
					Showing the first {MAX_PROJECT_BOARD_ITEMS} of {data.itemCount} items;
					filter to narrow the list.
				</p>
			)}
			{canWrite && (
				<ProjectFieldEditor
					login={login}
					number={Number(number)}
					fields={data.fields}
				/>
			)}
			<ProjectTable
				fields={data.fields}
				rows={data.items}
				emptyMessage={
					q
						? "No items match this filter."
						: "This project has no items you can see."
				}
				canWrite={canWrite}
				pending={setValue.isPending || clearValue.isPending}
				onSetValue={onSetValue}
				onClearValue={onClearValue}
				onEditDraft={onEditDraft}
			/>
			{canWrite && (
				<ProjectDraftDialog
					open={draftForm.open}
					onOpenChange={(open) => {
						if (!open)
							setDraftForm({ open: false, itemId: null, initial: EMPTY_DRAFT });
					}}
					initial={draftForm.initial}
					submitLabel={draftForm.itemId === null ? "Add draft" : "Save draft"}
					pending={addDraft.isPending || updateDraft.isPending}
					onSubmit={submitDraft}
				/>
			)}
			{data.pageCount > 1 && (
				<nav
					aria-label="Project item pages"
					className="flex items-center justify-between text-sm"
				>
					{data.page > 1 ? (
						<Link
							{...pageLink(data.page - 1)}
							className="text-bjork-accent hover:underline"
						>
							Previous
						</Link>
					) : (
						<span />
					)}
					<span className="text-bjork-text-soft">
						Page {data.page} of {data.pageCount}
					</span>
					{data.page < data.pageCount ? (
						<Link
							{...pageLink(data.page + 1)}
							className="text-bjork-accent hover:underline"
						>
							Next
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}
