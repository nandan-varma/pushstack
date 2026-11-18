import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { GitFork } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { forkRepository } from "@/server/repositories";

/**
 * Fork for a repository, with the fork count. The button forks into the
 * viewer's account and opens the new fork; when the viewer already has a fork
 * of this repository it links there instead, and a repository of that name
 * that is not a fork leaves the action disabled.
 */
export function RepoFork({
	owner,
	name,
	repo,
}: {
	owner: string;
	name: string;
	repo: {
		id: number;
		forksCount: number;
		viewerFork: { name: string; owner: { username: string } } | null;
		viewerNameTaken: boolean;
	};
}) {
	const { data: session } = useQuery(authSessionQueryOptions());
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { toast } = useToast();

	const mutation = useMutation({
		mutationFn: forkRepository,
		onSuccess: (fork) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot });
			queryClient.invalidateQueries({
				queryKey: queryKeys.repositoryByName(owner, name),
			});
			toast(`Forked to ${fork.owner.username}/${fork.name}`, "success");
			navigate({
				to: "/$owner/$name",
				params: { owner: fork.owner.username, name: fork.name },
			});
		},
		onError: (error: Error) => {
			toast(error.message || "Failed to fork repository", "error");
		},
	});

	const count = (
		<Link
			to="/$owner/$name/forks"
			params={{ owner, name }}
			aria-label={`${repo.forksCount} ${repo.forksCount === 1 ? "fork" : "forks"}`}
			className="flex items-center border-l border-bjork-border bg-bjork-panel px-3 text-[13px] font-medium tabular-nums text-bjork-text-medium hover:text-bjork-text"
		>
			{repo.forksCount}
		</Link>
	);

	if (repo.viewerFork) {
		return (
			<div className="flex h-9 w-full items-stretch overflow-hidden rounded-[13px] border border-bjork-border bg-bjork-surface text-sm shadow-[var(--bjork-shadow-soft)] transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
				<Button
					asChild
					variant="ghost"
					size="sm"
					className="h-full flex-1 justify-start gap-2 rounded-none border-0 px-3 text-bjork-text hover:bg-bjork-surface-hover focus-visible:ring-0"
				>
					<Link
						to="/$owner/$name"
						params={{
							owner: repo.viewerFork.owner.username,
							name: repo.viewerFork.name,
						}}
						title={`Your fork: ${repo.viewerFork.owner.username}/${repo.viewerFork.name}`}
					>
						<GitFork
							aria-hidden="true"
							className="size-4 text-bjork-text-soft"
						/>
						<span>Fork</span>
					</Link>
				</Button>
				{count}
			</div>
		);
	}

	const label = !session
		? "Sign in to fork this repository"
		: repo.viewerNameTaken
			? `You already have a repository called ${name}`
			: undefined;

	return (
		<div className="flex h-9 w-full items-stretch overflow-hidden rounded-[13px] border border-bjork-border bg-bjork-surface text-sm shadow-[var(--bjork-shadow-soft)] transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
			<LoadingButton
				variant="ghost"
				size="sm"
				isLoading={mutation.isPending}
				loadingLabel="Forking…"
				title={label}
				aria-label={`Fork ${owner}/${name}`}
				disabled={!session || repo.viewerNameTaken}
				onClick={() => mutation.mutate({ data: { repoId: repo.id } })}
				className="h-full flex-1 justify-start gap-2 rounded-none border-0 px-3 text-bjork-text hover:bg-bjork-surface-hover focus-visible:ring-0"
			>
				<GitFork aria-hidden="true" className="size-4 text-bjork-text-soft" />
				<span>Fork</span>
			</LoadingButton>
			{count}
		</div>
	);
}
