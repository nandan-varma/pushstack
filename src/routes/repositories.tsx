import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { userRepositoriesQueryOptions } from "@/lib/query-options";
import { requireUserSession } from "@/lib/route-auth";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

export const Route = createFileRoute("/repositories")({
	component: RepositoriesPage,
	beforeLoad: async ({ context }) => {
		const session = await requireUserSession(context.queryClient);

		return { user: session.user };
	},
});

function RepositoriesPage() {
	const repositorySkeletons = [
		"repository-skeleton-1",
		"repository-skeleton-2",
		"repository-skeleton-3",
		"repository-skeleton-4",
	];
	const { data: repositories, isLoading } = useQuery(
		userRepositoriesQueryOptions(),
	);

	return (
		<main className="page-wrap py-8">
			<div className="mb-8 flex items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold text-[var(--sea-ink)]">
						Repositories
					</h1>
					<p className="mt-2 text-[var(--sea-ink-soft)]">
						Browse and manage the repositories you can access.
					</p>
				</div>
				<Link to="/repositories/new">
					<Button>+ New Repository</Button>
				</Link>
			</div>

			{isLoading ? (
				<div className="grid gap-4 md:grid-cols-2">
					{repositorySkeletons.map((skeletonId) => (
						<div
							key={skeletonId}
							className="h-36 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--card-bg)]"
						/>
					))}
				</div>
			) : repositories && repositories.length > 0 ? (
				<div className="grid gap-4 md:grid-cols-2">
					{repositories.map((repo) => {
						const ownerUsername = repo.owner?.username || "unknown";

						return (
							<Link
								key={repo.id}
								to="/repo/$owner/$name"
								params={{ owner: ownerUsername, name: repo.name }}
							>
								<Card className="h-full p-6 transition hover:border-[var(--lagoon-deep)] hover:shadow-lg">
									<div className="flex items-start justify-between gap-4">
										<div>
											<h2 className="text-xl font-semibold text-[var(--lagoon-deep)]">
												{repo.name}
											</h2>
											{repo.description ? (
												<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
													{repo.description}
												</p>
											) : (
												<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
													No description
												</p>
											)}
										</div>
										<span
											className={`rounded-full border px-2 py-1 text-xs ${
												repo.visibility === "public"
													? "border-green-500 text-green-600"
													: "border-yellow-500 text-yellow-600"
											}`}
										>
											{repo.visibility}
										</span>
									</div>
									<div className="mt-4 flex items-center justify-between text-xs text-[var(--sea-ink-soft)]">
										<span>
											{ownerUsername}/{repo.name}
										</span>
										<span>{new Date(repo.updatedAt).toLocaleDateString()}</span>
									</div>
								</Card>
							</Link>
						);
					})}
				</div>
			) : (
				<Card className="p-12 text-center">
					<p className="text-[var(--sea-ink-soft)]">No repositories yet.</p>
					<Link to="/repositories/new">
						<Button className="mt-4">Create your first repository</Button>
					</Link>
				</Card>
			)}
		</main>
	);
}
