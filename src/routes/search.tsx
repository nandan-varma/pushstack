import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FilterTabs } from "@/components/FilterTabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { VisibilityBadge } from "@/components/ui/visibility-badge";
import {
	searchRepositoriesQueryOptions,
	searchUsersQueryOptions,
} from "@/lib/query-options";
import type { searchRepositories } from "@/server/search";

type SearchType = "repositories" | "users";

export const Route = createFileRoute("/search")({
	component: SearchPage,
	validateSearch: (
		search: Record<string, unknown>,
	): { q?: string; type?: SearchType } => ({
		q: typeof search.q === "string" && search.q ? search.q : undefined,
		type: search.type === "users" ? "users" : undefined,
	}),
	loaderDeps: ({ search }) => ({ q: search.q, type: search.type }),
	loader: async ({ context: { queryClient }, deps }) => {
		if (!deps.q) return;
		// Prefetch only the visible tab during SSR; the other tab's query (needed
		// for its result count) streams in client-side.
		if (deps.type === "users") {
			await queryClient.ensureQueryData(searchUsersQueryOptions(deps.q));
		} else {
			await queryClient.ensureQueryData(searchRepositoriesQueryOptions(deps.q));
		}
	},
});

function SearchPage() {
	const { q = "", type = "repositories" } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [inputValue, setInputValue] = useState(q);

	// Keep the input in sync when the query changes via back/forward or the
	// header search box.
	useEffect(() => {
		setInputValue(q);
	}, [q]);

	const repoResults = useQuery({
		...searchRepositoriesQueryOptions(q),
		enabled: q.length > 0,
	});
	const userResults = useQuery({
		...searchUsersQueryOptions(q),
		enabled: q.length > 0,
	});

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		const query = inputValue.trim();
		if (!query) return;
		navigate({
			search: { q: query, type: type === "users" ? type : undefined },
		});
	};

	const active = type === "users" ? userResults : repoResults;

	return (
		<main className="page-wrap px-4 py-10">
			<div className="mb-6">
				<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
					Search
				</h1>
				<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
					Find repositories and people across PushStack.
				</p>
			</div>

			<form onSubmit={handleSubmit} className="mb-6 flex max-w-xl gap-2">
				<Input
					type="search"
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					placeholder="Search repositories and users…"
					aria-label="Search query"
					autoFocus
				/>
				<Button type="submit" size="sm" className="h-9">
					Search
				</Button>
			</form>

			{q ? (
				<>
					<div className="mb-5">
						<FilterTabs<SearchType>
							tabs={[
								{
									value: "repositories",
									label: "Repositories",
									count: repoResults.data?.length,
								},
								{
									value: "users",
									label: "Users",
									count: userResults.data?.length,
								},
							]}
							activeTab={type}
							onTabChange={(next) =>
								navigate({
									search: { q, type: next === "users" ? next : undefined },
									replace: true,
								})
							}
						/>
					</div>

					{active.isLoading ? (
						<div className="grid gap-3 md:grid-cols-2">
							{[1, 2, 3, 4].map((i) => (
								<Skeleton key={i} className="h-24" />
							))}
						</div>
					) : active.isError ? (
						<EmptyState
							variant="error"
							message="Search failed."
							action={
								<Button
									size="sm"
									variant="outline"
									onClick={() => active.refetch()}
								>
									Try again
								</Button>
							}
						/>
					) : type === "repositories" ? (
						<RepositoryResults
							repositories={repoResults.data ?? []}
							query={q}
						/>
					) : (
						<UserResults users={userResults.data ?? []} query={q} />
					)}
				</>
			) : (
				<EmptyState message="Type a query to search public repositories and users." />
			)}
		</main>
	);
}

function RepositoryResults({
	repositories,
	query,
}: {
	repositories: Awaited<ReturnType<typeof searchRepositories>>;
	query: string;
}) {
	if (repositories.length === 0) {
		return <EmptyState message={`No repositories matching "${query}".`} />;
	}

	return (
		<div className="grid gap-3 md:grid-cols-2">
			{repositories.map((repo) => {
				const ownerUsername = repo.owner?.username || "unknown";
				return (
					<Link
						key={repo.id}
						to="/repo/$owner/$name/tree/$branch/$"
						params={{
							owner: ownerUsername,
							name: repo.name,
							branch: repo.defaultBranch || "main",
							_splat: "",
						}}
						className="island-shell feature-card block rounded-xl p-5 no-underline"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<h2
										title={`${ownerUsername}/${repo.name}`}
										className="truncate text-sm font-semibold text-[var(--lagoon-deep)]"
									>
										{ownerUsername}/{repo.name}
									</h2>
									<VisibilityBadge visibility={repo.visibility} />
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
	);
}

function UserResults({
	users,
	query,
}: {
	users: {
		id: string;
		username: string | null;
		displayUsername: string | null;
		name: string;
		image: string | null;
	}[];
	query: string;
}) {
	if (users.length === 0) {
		return <EmptyState message={`No users matching "${query}".`} />;
	}

	return (
		<div className="grid gap-3 md:grid-cols-2">
			{users.map((person) => {
				const card = (
					<div className="flex items-center gap-3">
						<Avatar>
							{person.image && (
								<AvatarImage src={person.image} alt={person.name} />
							)}
							<AvatarFallback>
								{person.name.charAt(0).toUpperCase()}
							</AvatarFallback>
						</Avatar>
						<div className="min-w-0">
							<div className="truncate text-sm font-semibold text-[var(--sea-ink)]">
								{person.name}
							</div>
							{person.username && (
								<div className="truncate text-xs text-[var(--sea-ink-soft)]">
									@{person.displayUsername || person.username}
								</div>
							)}
						</div>
					</div>
				);

				if (!person.username) {
					return (
						<div key={person.id} className="island-shell rounded-xl p-4">
							{card}
						</div>
					);
				}

				return (
					<Link
						key={person.id}
						to="/users/$username"
						params={{ username: person.username }}
						className="island-shell feature-card block rounded-xl p-4 no-underline"
					>
						{card}
					</Link>
				);
			})}
		</div>
	);
}
