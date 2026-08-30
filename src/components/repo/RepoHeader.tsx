import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { CloneModal } from "@/components/CloneModal";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { VisibilityBadge } from "@/components/ui/visibility-badge";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { cn } from "@/lib/utils";
import { toggleStar } from "@/server/repositories";

export function RepoHeaderSkeleton() {
	return (
		<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<div className="h-4 w-40 animate-pulse rounded bg-muted" />
					<div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
				</div>
				<div className="h-3.5 w-56 animate-pulse rounded bg-muted" />
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
				<div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
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
						to="/users/$username"
						params={{ username: owner }}
						className="font-medium text-muted-foreground hover:text-foreground"
					>
						{owner}
					</Link>
					<span className="text-muted-foreground">/</span>
					<span className="font-semibold text-foreground">{name}</span>
					<VisibilityBadge visibility={repo.visibility} />
				</div>
				{repo.description && (
					<p className="mt-1.5 text-sm text-muted-foreground">
						{repo.description}
					</p>
				)}
			</div>

			<div className="flex shrink-0 items-center gap-2">
				<CloneModal owner={owner} repoName={name} />
				<Button
					type="button"
					variant="outline"
					onClick={() =>
						session
							? starMutation.mutate({ data: { repoId: repo.id } })
							: toast("Sign in to star this repository", "info")
					}
					title={!session ? "Sign in to star this repository" : undefined}
					className={cn(
						"h-auto gap-0 overflow-hidden p-0",
						repo.isStarred
							? "border-primary bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground"
							: "border-border bg-transparent text-foreground hover:bg-accent",
						!session && "opacity-50",
					)}
				>
					<span className="px-3 py-1.5">
						<Star
							className={`size-4 ${repo.isStarred ? "fill-current" : ""}`}
						/>
					</span>
					<span className="border-l border-current/20 px-2.5 py-1.5 tabular-nums">
						{repo.starCount}
					</span>
				</Button>
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
