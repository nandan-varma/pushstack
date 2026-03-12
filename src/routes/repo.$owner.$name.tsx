import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { CloneModal } from "@/components/CloneModal";
import { Button } from "@/components/ui/button";
import {
	authSessionQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { toggleStar } from "../server/repositories";

const repoRouteSchema = z.object({
	owner: z.string(),
	name: z.string(),
});

export const Route = createFileRoute("/repo/$owner/$name")({
	component: RepositoryPage,
	parseParams: (params) => repoRouteSchema.parse(params),
});

function RepositoryPage() {
	const { owner, name } = Route.useParams();
	const { data: session } = useQuery(authSessionQueryOptions());
	const queryClient = useQueryClient();

	const { data: repo, isLoading } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const starMutation = useMutation({
		mutationFn: toggleStar,
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.repositoryByName(owner, name),
				}),
				queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot }),
			]);
		},
	});

	if (isLoading) {
		return (
			<div className="page-wrap py-8">
				<div className="h-64 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--card-bg)]" />
			</div>
		);
	}

	if (!repo) {
		return (
			<div className="page-wrap py-8">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-[var(--sea-ink)]">
						Repository not found
					</h1>
					<Link to="/dashboard">
						<Button className="mt-4">Back to Dashboard</Button>
					</Link>
				</div>
			</div>
		);
	}

	const isOwner = repo.ownerId === session?.user?.id;

	return (
		<div className="page-wrap py-8">
			{/* Repository Header */}
			<div className="mb-6">
				<div className="flex items-start justify-between">
					<div>
						<div className="flex items-center gap-2 text-[var(--sea-ink-soft)]">
							<Link to="/repositories" className="hover:underline">
								{owner}
							</Link>
							<span>/</span>
							<span className="font-semibold text-[var(--sea-ink)]">
								{name}
							</span>
							<span
								className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-xs ${repo.visibility === "public" ? "border-green-500 text-green-600" : "border-yellow-500 text-yellow-600"}`}
							>
								{repo.visibility}
							</span>
						</div>
						{repo.description && (
							<p className="mt-2 text-[var(--sea-ink-soft)]">
								{repo.description}
							</p>
						)}
					</div>

					<div className="flex gap-2">
						<CloneModal owner={owner} repoName={name} />

						<Button
							variant="outline"
							size="sm"
							onClick={() => starMutation.mutate({ data: { repoId: repo.id } })}
							disabled={starMutation.isPending}
						>
							☆ Star
						</Button>

						{isOwner && (
							<Link to="/repo/$owner/$name/setup" params={{ owner, name }}>
								<Button variant="outline" size="sm">
									Settings
								</Button>
							</Link>
						)}
					</div>
				</div>
			</div>

			{/* Navigation Tabs */}
			<div className="mb-6 border-b border-[var(--line)]">
				<nav className="flex gap-6">
					<Link
						to="/repo/$owner/$name"
						params={{ owner, name }}
						className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium transition hover:text-[var(--lagoon-deep)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]"
						activeProps={{ className: "active" }}
					>
						Code
					</Link>
					<Link
						to="/repo/$owner/$name/issues"
						params={{ owner, name }}
						className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium transition hover:text-[var(--lagoon-deep)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]"
						activeProps={{ className: "active" }}
					>
						Issues
					</Link>
					<Link
						to="/repo/$owner/$name/pulls"
						params={{ owner, name }}
						className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium transition hover:text-[var(--lagoon-deep)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]"
						activeProps={{ className: "active" }}
					>
						Pull Requests
					</Link>
					<Link
						to="/repo/$owner/$name/commits"
						params={{ owner, name }}
						className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium transition hover:text-[var(--lagoon-deep)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]"
						activeProps={{ className: "active" }}
					>
						Commits
					</Link>
				</nav>
			</div>

			{/* Content Area */}
			<Outlet />
		</div>
	);
}
