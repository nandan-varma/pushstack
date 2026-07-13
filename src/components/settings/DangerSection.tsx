import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Section } from "@/components/Section";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { queryKeys } from "@/lib/query-options";
import { deleteRepository } from "@/server/repositories";

export function DangerSection({
	repo,
	owner,
	name,
}: {
	repo: { id: number };
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

	return (
		<Section
			danger
			title="Danger zone"
			description={`Permanently delete ${owner}/${name} and all its data. This cannot be undone.`}
		>
			{error && (
				<p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
			)}
			<div className="space-y-3">
				<div className="flex gap-3">
					<Input
						className="flex-1"
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
					<p className="text-xs text-[var(--sea-ink-soft)]">
						Please type{" "}
						<span className="font-medium text-[var(--sea-ink)]">"{name}"</span>{" "}
						to confirm
					</p>
				)}
				{confirm === name && (
					<p className="text-xs text-red-600 dark:text-red-400">
						Type confirmed. Click "Delete repository" to proceed.
					</p>
				)}
			</div>
		</Section>
	);
}
