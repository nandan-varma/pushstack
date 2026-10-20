import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LabelChip } from "@/components/LabelChip";
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
			className="grid gap-3 sm:grid-cols-[1fr_8rem_2fr_auto] sm:items-end"
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
						className="font-mono"
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
				/>
			</div>
			<div className="flex gap-2">
				<LoadingButton
					type="submit"
					size="sm"
					isLoading={pending}
					loadingLabel="Saving…"
					disabled={!draft.name.trim() || !validColor}
				>
					{submitLabel}
				</LoadingButton>
				{onCancel && (
					<Button type="button" size="sm" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
				)}
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
			<div className="p-4">
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
		);
	}
	return (
		<div className="flex items-center gap-4 p-4">
			<div className="w-48 shrink-0">
				<LabelChip {...label} />
			</div>
			<p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
				{label.description}
			</p>
			{canWrite && (
				<div className="flex shrink-0 gap-2">
					<Button size="sm" variant="outline" onClick={() => setEditing(true)}>
						Edit
					</Button>
					<LoadingButton
						size="sm"
						variant="outline"
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
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-base font-semibold text-foreground">Labels</h2>
				<div className="flex gap-2">
					<Link to="/$owner/$name/issues" params={{ owner, name }}>
						<Button size="sm" variant="outline">
							Issues
						</Button>
					</Link>
					{canWrite && (
						<Button size="sm" onClick={() => setCreating(true)}>
							New label
						</Button>
					)}
				</div>
			</div>

			{creating && repo && (
				<div className="rounded-xl border border-border p-4">
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
				<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
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
						<p className="p-4 text-sm text-muted-foreground">No labels yet.</p>
					)}
				</div>
			)}
		</div>
	);
}
