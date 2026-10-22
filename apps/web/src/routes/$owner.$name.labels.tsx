import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LabelChip } from "@/components/LabelChip";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LabelView } from "@/lib/labels";
import {
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryLabelsQueryOptions,
} from "@/lib/query-options";
import { createLabel, deleteLabel, updateLabel } from "@/server/labels";

export const Route = createFileRoute("/$owner/$name/labels")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(repositoryLabelsQueryOptions(repo.id));
		}
	},
	component: LabelsPage,
});

function randomColor(): string {
	return Math.floor(Math.random() * 0xffffff)
		.toString(16)
		.padStart(6, "0");
}

interface Draft {
	name: string;
	color: string;
	description: string;
}

/** One shared column template so the header and every row line up. */
const labelGridClass =
	"grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]";

function LabelForm({
	initial,
	submitLabel,
	pending,
	onSubmit,
	onCancel,
}: {
	initial: Draft;
	submitLabel: string;
	pending: boolean;
	onSubmit: (draft: Draft) => void;
	onCancel?: () => void;
}) {
	const [draft, setDraft] = useState(initial);
	const validColor = /^#?[0-9a-fA-F]{6}$/.test(draft.color.trim());
	return (
		<form
			className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,2fr)_auto] sm:items-end"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(draft);
			}}
		>
			<div className="space-y-1.5">
				<Label>Name</Label>
				<Input
					value={draft.name}
					maxLength={50}
					onChange={(e) => setDraft({ ...draft, name: e.target.value })}
					placeholder="Label name"
					className="h-10"
				/>
			</div>
			<div className="space-y-1.5">
				<Label>Color</Label>
				<div className="flex items-center gap-2">
					<span
						className="size-6 shrink-0 rounded-full border border-border"
						style={{
							backgroundColor: validColor
								? `#${draft.color.replace(/^#/, "")}`
								: undefined,
						}}
					/>
					<Input
						value={draft.color}
						maxLength={7}
						onChange={(e) => setDraft({ ...draft, color: e.target.value })}
						className="h-10 min-w-0 font-mono"
					/>
				</div>
			</div>
			<div className="space-y-1.5">
				<Label>Description</Label>
				<Input
					value={draft.description}
					maxLength={100}
					onChange={(e) => setDraft({ ...draft, description: e.target.value })}
					placeholder="Description (optional)"
					className="h-10"
				/>
			</div>
			<div className="flex items-center justify-end gap-2">
				{onCancel && (
					<Button type="button" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
				)}
				<LoadingButton
					type="submit"
					isLoading={pending}
					loadingLabel="Saving…"
					disabled={!draft.name.trim() || !validColor}
				>
					{submitLabel}
				</LoadingButton>
			</div>
		</form>
	);
}

function LabelRow({
	label,
	repoId,
	canWrite,
}: {
	label: LabelView;
	repoId: number;
	canWrite: boolean;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [editing, setEditing] = useState(false);
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["repos", repoId] });
	const update = useMutation({
		mutationFn: updateLabel,
		onSuccess: () => {
			setEditing(false);
			refresh();
		},
		onError: (err: Error) => toast(err.message, "error"),
	});
	const remove = useMutation({
		mutationFn: deleteLabel,
		onSuccess: refresh,
		onError: (err: Error) => toast(err.message, "error"),
	});

	if (editing) {
		return (
			<div className="bg-muted/30 p-4">
				<div className="rounded-[16px] border border-border bg-card p-5">
					<LabelForm
						initial={{
							name: label.name,
							color: label.color,
							description: label.description ?? "",
						}}
						submitLabel="Save"
						pending={update.isPending}
						onCancel={() => setEditing(false)}
						onSubmit={(draft) =>
							update.mutate({
								data: { repoId, labelId: label.id, ...draft },
							})
						}
					/>
				</div>
			</div>
		);
	}
	return (
		<div className={`${labelGridClass} transition-colors hover:bg-accent/40`}>
			<div className="min-w-0">
				<LabelChip {...label} />
			</div>
			<p className="min-w-0 text-sm break-words text-muted-foreground">
				{label.description}
			</p>
			{canWrite && (
				<div className="flex items-center gap-2 sm:justify-end">
					<Button variant="outline" onClick={() => setEditing(true)}>
						Edit
					</Button>
					<span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
					<LoadingButton
						variant="destructive"
						isLoading={remove.isPending}
						loadingLabel="Deleting…"
						onClick={() => {
							if (
								window.confirm(
									`Delete the "${label.name}" label? It is removed from every issue and pull request.`,
								)
							) {
								remove.mutate({ data: { repoId, labelId: label.id } });
							}
						}}
					>
						Delete
					</LoadingButton>
				</div>
			)}
		</div>
	);
}

function LabelsPage() {
	const { owner, name } = Route.useParams();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data, isLoading } = useQuery({
		...repositoryLabelsQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});
	const [creating, setCreating] = useState(false);
	const create = useMutation({
		mutationFn: createLabel,
		onSuccess: () => {
			setCreating(false);
			if (repo) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoLabels(repo.id),
				});
			}
		},
		onError: (err: Error) => toast(err.message, "error"),
	});

	const canWrite = data?.viewer.canWrite ?? false;
	return (
		<div className="space-y-4">
			<PageHeader
				title="Labels"
				actions={
					<>
						<Link to="/$owner/$name/issues" params={{ owner, name }}>
							<Button variant="outline">Issues</Button>
						</Link>
						{canWrite && (
							<Button onClick={() => setCreating(true)}>New label</Button>
						)}
					</>
				}
			/>

			{creating && repo && (
				<div className="island-shell rounded-[20px] p-5">
					<LabelForm
						initial={{ name: "", color: randomColor(), description: "" }}
						submitLabel="Create label"
						pending={create.isPending}
						onCancel={() => setCreating(false)}
						onSubmit={(draft) =>
							create.mutate({ data: { repoId: repo.id, ...draft } })
						}
					/>
				</div>
			)}

			{isLoading || !repo ? (
				<Skeleton className="h-32" />
			) : (
				<div className="island-shell divide-y divide-border overflow-hidden rounded-[20px]">
					<div
						className={`${labelGridClass} sticky top-0 z-10 hidden bg-muted/40 py-2.5 text-xs font-medium text-muted-foreground backdrop-blur sm:grid`}
					>
						<span>Label</span>
						<span>Description</span>
						<span className="text-right">Actions</span>
					</div>
					{data?.labels.length ? (
						data.labels.map((label) => (
							<LabelRow
								key={label.id}
								label={label}
								repoId={repo.id}
								canWrite={canWrite}
							/>
						))
					) : (
						<p className="px-4 py-6 text-sm text-muted-foreground">
							No labels yet.
						</p>
					)}
				</div>
			)}
		</div>
	);
}
