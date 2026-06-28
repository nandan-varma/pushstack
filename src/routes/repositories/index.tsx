import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth-session";
import { userRepositoriesQueryOptions } from "@/lib/query-options";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";

export const Route = createFileRoute("/repositories/")({
	component: RepositoriesPage,
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) {
			throw redirect({ to: "/auth/login" });
		}
		return { user: session.user };
	},
});

function RepositoriesPage() {
	const { data: repositories, isLoading } = useQuery(
		userRepositoriesQueryOptions(),
	);

	return (
		<main className="page-wrap px-4 py-10">
			<div className="mb-8 flex items-center justify-between gap-4">
				<div>
					<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
						Repositories
					</h1>
					<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
						Browse and manage the repositories you can access.
					</p>
				</div>
				<Link to="/repositories/new">
					<Button size="sm">+ New repository</Button>
				</Link>
			</div>

			{isLoading ? (
				<div className="grid gap-3 md:grid-cols-2">
					{[1, 2, 3, 4].map((i) => (
						<Skeleton key={i} className="h-28" />
					))}
				</div>
			) : repositories && repositories.length > 0 ? (
				<div className="grid gap-3 md:grid-cols-2">
					{repositories.map((repo) => {
						const ownerUsername = repo.owner?.username || "unknown";

						return (
							<Link
								key={repo.id}
								to="/repo/$owner/$name"
								params={{ owner: ownerUsername, name: repo.name }}
								className="island-shell feature-card block rounded-xl p-5 no-underline"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<h2 className="truncate text-sm font-semibold text-[var(--lagoon-deep)]">
												{ownerUsername}/{repo.name}
											</h2>
											<span
												className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
													repo.visibility === "public"
														? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
														: "border-[var(--line)] text-[var(--sea-ink-soft)]"
												}`}
											>
												{repo.visibility}
											</span>
										</div>
										<p className="mt-1 line-clamp-2 text-xs text-[var(--sea-ink-soft)]">
											{repo.description || "No description"}
										</p>
									</div>
									<span className="shrink-0 text-xs text-[var(--sea-ink-soft)]">
										{new Date(repo.updatedAt).toLocaleDateString()}
									</span>
								</div>
							</Link>
						);
					})}
				</div>
			) : (
				<div className="island-shell rounded-xl p-12 text-center">
					<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
						No repositories yet.
					</p>
					<Link to="/repositories/new">
						<Button size="sm">Create your first repository</Button>
					</Link>
				</div>
			)}
		</main>
	);
}
