import { SettingsIcon } from "@animateicons/react/lucide";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useIconAnimation } from "@/components/animated-icon";
import { StarButton } from "@/components/repo/StarButton";
import { useToast } from "@/components/toast-provider";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VisibilityBadge } from "@/components/ui/visibility-badge";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { toggleStar } from "@/server/repositories";

export function RepoHeaderSkeleton() {
	return (
		<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
			<div className="flex items-center gap-2">
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-5 w-14 rounded-full" />
			</div>
			<div className="flex items-center gap-2">
				<Skeleton className="h-10 w-28 rounded-[13px]" />
				<Skeleton className="size-10 rounded-[13px]" />
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
		<div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
			<h1 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xl tracking-[-0.02em]">
				<Link
					to="/$owner"
					params={{ owner: owner }}
					className="font-medium text-bjork-text-muted hover:text-bjork-text"
				>
					{owner}
				</Link>
				<span aria-hidden="true" className="text-bjork-text-faint">
					/
				</span>
				<Link
					to="/$owner/$name"
					params={{ owner, name }}
					className="font-semibold break-words text-bjork-text"
				>
					{name}
				</Link>
				<VisibilityBadge visibility={repo.visibility} />
			</h1>

			<div className="flex items-center gap-2">
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
				{isOwner && <SettingsLink owner={owner} name={name} />}
			</div>
		</div>
	);
}

function SettingsLink({ owner, name }: { owner: string; name: string }) {
	const { ref, triggerProps } = useIconAnimation<HTMLAnchorElement>();
	return (
		<Link
			to="/$owner/$name/settings"
			params={{ owner, name }}
			aria-label="Repository settings"
			title="Repository settings"
			className={buttonVariants({ variant: "outline", size: "icon" })}
			{...triggerProps}
		>
			<SettingsIcon ref={ref} size={16} aria-hidden="true" />
		</Link>
	);
}
