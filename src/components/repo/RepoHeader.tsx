import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { CloneModal } from "@/components/CloneModal";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { toggleStar } from "@/server/repositories";

export function RepoHeader({
	owner,
	name,
	repo,
}: {
	owner: string;
	name: string;
	repo: {
		id: number;
		visibility: string;
		description: string | null;
		defaultBranch: string | null;
		isStarred: boolean;
		starCount: number;
		ownerId: string;
	};
}) {
	const { data: session } = useQuery(authSessionQueryOptions());
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const isOwner = repo.ownerId === session?.user?.id;

	const repoQueryKey = queryKeys.repositoryByName(owner, name);

	const starMutation = useMutation({
		mutationFn: toggleStar,
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: repoQueryKey });
			const prev = queryClient.getQueryData(repoQueryKey);
			queryClient.setQueryData(repoQueryKey, (old: typeof repo | undefined) =>
				old
					? {
							...old,
							isStarred: !old.isStarred,
							starCount: old.isStarred ? old.starCount - 1 : old.starCount + 1,
						}
					: old,
			);
			return { prev };
		},
		onError: (err: Error, _vars, ctx) => {
			if (ctx?.prev) queryClient.setQueryData(repoQueryKey, ctx.prev);
			toast(err.message || "Failed to update star", "error");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: repoQueryKey });
			queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot });
		},
	});

	return (
		<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div>
				<div className="flex flex-wrap items-center gap-1.5 text-sm">
					<Link
						to="/repositories"
						className="font-medium text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
					>
						{owner}
					</Link>
					<span className="text-[var(--sea-ink-soft)]">/</span>
					<span className="font-semibold text-[var(--sea-ink)]">{name}</span>
					<span
						className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
							repo.visibility === "public"
								? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
								: "border-[var(--line)] text-[var(--sea-ink-soft)]"
						}`}
					>
						{repo.visibility}
					</span>
				</div>
				{repo.description && (
					<p className="mt-1.5 text-sm text-[var(--sea-ink-soft)]">
						{repo.description}
					</p>
				)}
			</div>

			<div className="flex shrink-0 items-center gap-2">
				<CloneModal owner={owner} repoName={name} />
				<button
					type="button"
					onClick={() =>
						session
							? starMutation.mutate({ data: { repoId: repo.id } })
							: toast("Sign in to star this repository", "info")
					}
					title={!session ? "Sign in to star this repository" : undefined}
					className={`flex items-center gap-0 overflow-hidden rounded-md border text-sm font-medium transition-colors ${
						repo.isStarred
							? "border-[var(--lagoon-deep)] bg-[var(--lagoon-deep)] text-white"
							: "border-[var(--line)] bg-transparent text-[var(--sea-ink)] hover:bg-[var(--surface-raised)]"
					} ${!session ? "opacity-50" : ""}`}
				>
					<span className="px-3 py-1.5">
						<Star
							className={`size-4 ${repo.isStarred ? "fill-current" : ""}`}
						/>
					</span>
					<span className="border-l border-current/20 px-2.5 py-1.5 tabular-nums">
						{repo.starCount}
					</span>
				</button>
				{isOwner && (
					<Link to="/repo/$owner/$name/settings" params={{ owner, name }}>
						<Button variant="outline" size="sm">
							Settings
						</Button>
					</Link>
				)}
			</div>
		</div>
	);
}
