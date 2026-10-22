import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Compass, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FilterTabs } from "@/components/FilterTabs";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { RepositoryRow } from "@/components/repo/RepositoryList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	searchRepositoriesQueryOptions,
	searchUsersQueryOptions,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";
import type { searchRepositories, searchUsers } from "@/server/search";

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
		<div className="page-wrap space-y-4 py-6">
			<h1 className="sr-only">Search</h1>
			<form
				onSubmit={handleSubmit}
				role="search"
				className="relative max-w-2xl"
			>
				<Search
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-4 z-10 size-5 -translate-y-1/2 text-bjork-text-soft"
				/>
				<Input
					type="search"
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					placeholder="Search repositories and people"
					aria-label="Search query"
					className="h-12 pl-12 text-base md:text-[15px]"
				/>
				<button type="submit" className="sr-only">
					Search
				</button>
			</form>

			{q ? (
				<Panel aria-labelledby="search-results-heading">
					<h2 id="search-results-heading" className="sr-only">
						Results for {q}
					</h2>
					<PanelHeader>
						<FilterTabs<SearchType>
							variant="inline"
							label="Result type"
							tabs={[
								{
									value: "repositories",
									label: "Repositories",
									count: repoResults.data?.length,
								},
								{
									value: "users",
									label: "People",
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
					</PanelHeader>
					{active.isLoading ? (
						<ul aria-busy="true" className="divide-y divide-bjork-border-muted">
							{[1, 2, 3].map((i) => (
								<li key={i} className="flex h-12 items-center gap-4 px-4">
									<Skeleton className="h-3.5 w-40" />
									<Skeleton className="h-3 flex-1" />
								</li>
							))}
						</ul>
					) : active.isError ? (
						<EmptyState
							bare
							variant="error"
							message="Search failed."
							action={
								<Button variant="outline" onClick={() => active.refetch()}>
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
				</Panel>
			) : (
				<EmptyState
					icon={<Compass />}
					title="Explore PushStack"
					message="Search public repositories by name or description, or find people by username."
				/>
			)}
		</div>
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
		return <EmptyState bare message={`No repositories match “${query}”.`} />;
	}
	return (
		<ul className="divide-y divide-bjork-border-muted">
			{repositories.map((repo) => (
				<RepositoryRow key={repo.id} repo={repo} />
			))}
		</ul>
	);
}

function UserResults({
	users,
	query,
}: {
	users: Awaited<ReturnType<typeof searchUsers>>;
	query: string;
}) {
	if (users.length === 0) {
		return <EmptyState bare message={`No people match “${query}”.`} />;
	}
	return (
		<ul className="divide-y divide-bjork-border-muted">
			{users.map((person) => (
				<li key={person.id}>
					<Link
						to="/$owner"
						params={{ owner: person.username }}
						className="flex min-h-12 items-center gap-3 px-4 py-2 transition-[background-color] duration-150 hover:bg-bjork-surface-hover"
					>
						<Avatar size="sm">
							{person.image && <AvatarImage src={person.image} alt="" />}
							<AvatarFallback className="text-[11px]">
								{getInitials(person.name)}
							</AvatarFallback>
						</Avatar>
						<span className="truncate text-sm font-semibold text-bjork-text">
							{person.name}
						</span>
						<span className="truncate text-sm text-bjork-text-soft">
							@{person.username}
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}
