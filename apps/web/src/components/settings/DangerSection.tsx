import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Section } from "@/components/Section";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { queryKeys } from "@/lib/query-options";
import {
	deleteRepository,
	transferRepositoryToUser,
	updateRepository,
} from "@/server/repositories";

export function DangerSection({
	repo,
	owner,
	name,
}: {
	repo: { id: number; archived: boolean };
	owner: string;
	name: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");

	const deleteMutation = useMutation({
		mutationFn: () => deleteRepository({ data: { id: repo.id } }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot });
			navigate({ to: "/repositories" });
		},
		onError: (e: Error) => setError(e.message),
	});

	const [newOwner, setNewOwner] = useState("");
	const archiveMutation = useMutation({
		mutationFn: () =>
			updateRepository({ data: { id: repo.id, archived: !repo.archived } }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.repositoryByName(owner, name),
			});
			setError("");
		},
		onError: (e: Error) => setError(e.message),
	});
	const transferMutation = useMutation({
		mutationFn: () =>
			transferRepositoryToUser({ data: { id: repo.id, newOwner } }),
		onSuccess: (moved) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot });
			navigate({
				to: "/$owner/$name",
				params: { owner: moved.owner.username, name: moved.name },
			});
		},
		onError: (e: Error) => setError(e.message),
	});

	return (
		<Section
			danger
			title="Danger zone"
			description={`Permanently delete ${owner}/${name} and all its data. This cannot be undone.`}
		>
			{error && <FieldError className="mb-3">{error}</FieldError>}
			<div className="mb-5 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-sm text-muted-foreground">
					{repo.archived
						? "This repository is archived: pushes, issues, comments and pull requests are blocked."
						: "Archiving makes the repository read-only: pushes, issues, comments and pull requests are blocked."}
				</p>
				<LoadingButton
					variant="outline"
					isLoading={archiveMutation.isPending}
					loadingLabel="Saving…"
					onClick={() => archiveMutation.mutate()}
				>
					{repo.archived ? "Unarchive repository" : "Archive repository"}
				</LoadingButton>
			</div>
			<div className="mb-5 space-y-2 border-b border-border pb-5">
				<p className="text-sm text-muted-foreground">
					Transfer this repository to another user. It moves immediately and the
					old URL stops working.
				</p>
				<div className="flex flex-col gap-3 sm:flex-row">
					<Input
						className="min-w-0 flex-1"
						aria-label="New owner"
						placeholder="Username of the new owner"
						value={newOwner}
						onChange={(e) => setNewOwner(e.target.value)}
					/>
					<LoadingButton
						variant="destructive"
						isLoading={transferMutation.isPending}
						loadingLabel="Transferring…"
						disabled={!newOwner.trim() || repo.archived}
						onClick={() => transferMutation.mutate()}
					>
						Transfer repository
					</LoadingButton>
				</div>
			</div>
			<div className="space-y-3">
				<div className="flex flex-col gap-3 sm:flex-row">
					<Input
						className="min-w-0 flex-1"
						placeholder={`Type "${name}" to confirm`}
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
					/>
					<LoadingButton
						variant="destructive"
						isLoading={deleteMutation.isPending}
						loadingLabel="Deleting…"
						disabled={confirm !== name || !repo}
						onClick={() => deleteMutation.mutate()}
					>
						Delete repository
					</LoadingButton>
				</div>
				{confirm && confirm !== name && (
					<p className="text-xs text-muted-foreground">
						Please type{" "}
						<span className="font-medium text-foreground">"{name}"</span> to
						confirm
					</p>
				)}
				{confirm === name && (
					<FieldError className="text-xs">
						Type confirmed. Click "Delete repository" to proceed.
					</FieldError>
				)}
			</div>
		</Section>
	);
}
