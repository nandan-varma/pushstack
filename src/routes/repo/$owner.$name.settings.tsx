import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { repositoryByNameQueryOptions } from "@/lib/query-options";
import { deleteRepository } from "@/server/repositories";

export const Route = createFileRoute("/repo/$owner/$name/settings")({
	component: RouteComponent,
});

function RouteComponent() {
	const { owner, name } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const deleteMutation = useMutation({
		mutationFn: () => deleteRepository({ data: { id: repo?.id } }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["repositories"] });
			navigate({ to: "/repositories" });
		},
		onError: (err: Error) => setError(err.message),
	});

	return (
		<div className="page-wrap px-4 py-10">
			<div className="mx-auto max-w-2xl">
				<h1 className="display-title mb-8 text-3xl font-bold text-[var(--sea-ink)]">
					Settings
				</h1>

				<div className="island-shell rounded-2xl border border-red-300 p-6 dark:border-red-800/50">
					<h2 className="mb-1 text-base font-semibold text-red-700 dark:text-red-400">
						Delete repository
					</h2>
					<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
						This will permanently delete{" "}
						<strong>
							{owner}/{name}
						</strong>{" "}
						and all its data. This cannot be undone.
					</p>

					{error && (
						<p className="mb-3 text-sm text-red-600 dark:text-red-400">
							{error}
						</p>
					)}

					<div className="flex gap-3">
						<input
							className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
							placeholder={`Type "${name}" to confirm`}
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
						/>
						<Button
							variant="destructive"
							disabled={confirm !== name || deleteMutation.isPending || !repo}
							onClick={() => deleteMutation.mutate()}
						>
							{deleteMutation.isPending ? "Deleting…" : "Delete"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
