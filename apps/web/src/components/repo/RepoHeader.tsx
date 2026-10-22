import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CloneModal } from "@/components/CloneModal";
import { StarButton } from "@/components/repo/StarButton";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { VisibilityBadge } from "@/components/ui/visibility-badge";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { toggleStar } from "@/server/repositories";

export function RepoHeaderSkeleton() {
	return (
		<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<div className="h-4 w-40 animate-pulse rounded bg-muted" />
					<div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
				</div>
				<div className="h-3.5 w-56 animate-pulse rounded bg-muted" />
			</div>
			<div className="flex flex-wrap items-center gap-2 sm:shrink-0">
				<div className="h-10 w-24 animate-pulse rounded-[13px] bg-muted" />
				<div className="h-10 w-28 animate-pulse rounded-[13px] bg-muted" />
			</div>
		</div>
	);
}

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
		defaultBranch: string;
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
		...useOptimisticUpdate<typeof repo>(
			repoQueryKey,
			(old) =>
				old
					? {
							...old,
							isStarred: !old.isStarred,
							starCount: old.isStarred ? old.starCount - 1 : old.starCount + 1,
						}
					: old,
			"Failed to update star",
		),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: repoQueryKey });
			queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot });
		},
	});

	return (
		<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2 text-lg tracking-tight sm:text-xl">
					<Link
						to="/$owner"
						params={{ owner: owner }}
						className="font-medium text-muted-foreground hover:text-foreground"
					>
						{owner}
					</Link>
					<span className="text-muted-foreground">/</span>
					<span className="break-words font-semibold text-foreground">
						{name}
					</span>
					<VisibilityBadge visibility={repo.visibility} />
				</div>
				{repo.description && (
					<p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
						{repo.description}
					</p>
				)}
			</div>

			<div className="flex flex-wrap items-center gap-2 sm:shrink-0">
				<CloneModal owner={owner} repoName={name} />
				<StarButton
					starCount={repo.starCount}
					isStarred={repo.isStarred}
					isPending={starMutation.isPending}
					signedIn={Boolean(session)}
					onToggle={() =>
						session
							? starMutation.mutate({ data: { repoId: repo.id } })
							: toast("Sign in to star this repository", "info")
					}
				/>
				{isOwner && (
					<Link to="/$owner/$name/settings" params={{ owner, name }}>
						<Button variant="outline">Settings</Button>
					</Link>
				)}
			</div>
		</div>
	);
}
