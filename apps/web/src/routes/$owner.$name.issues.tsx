import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { Milestone, Tag } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Toolbar } from "@/components/layout/page";
import { ThreadSearchBox } from "@/components/ThreadSearchBox";
import {
	activeThreadTab,
	ISSUE_STATUS_TABS,
	ThreadFilters,
} from "@/components/thread-list/ThreadFilters";
import {
	SignInButton,
	ThreadList,
	ThreadRow,
} from "@/components/thread-list/ThreadList";
import { ThreadSplitView } from "@/components/thread-list/ThreadSplitView";
import {
	threadSearchDeps,
	validateThreadSearch,
} from "@/components/thread-list/thread-search";
import { buttonVariants } from "@/components/ui/button";
import {
	authSessionQueryOptions,
	repositoryByNameQueryOptions,
	repositoryIssueSearchQueryOptions,
} from "@/lib/query-options";
import { parseSearchQuery, withoutSearchAssignee } from "@/lib/search-query";

export const Route = createFileRoute("/$owner/$name/issues")({
	validateSearch: validateThreadSearch,
	loaderDeps: threadSearchDeps,
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(
				repositoryIssueSearchQueryOptions({ repoId: repo.id, query: deps.q }),
			);
		}
	},
	component: IssuesPage,
});

function IssuesPage() {
	const { owner, name } = Route.useParams();
	const { q = "" } = Route.useSearch();
	const search = useMemo(() => parseSearchQuery(q), [q]);
	const { pathname } = useLocation();
	const navigate = useNavigate({ from: Route.fullPath });

	const setQuery = useCallback(
		(next: string) => {
			navigate({ search: { q: next || undefined }, replace: true });
		},
		[navigate],
	);

	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: issues, isLoading } = useQuery({
		...repositoryIssueSearchQueryOptions({
			repoId: repo?.id ?? 0,
			query: q,
		}),
		enabled: !!repo,
	});

	const activeTab = activeThreadTab(q, ISSUE_STATUS_TABS);

	// The issues list is the parent of /issues/:id. Rendering the detail
	// Outlet here keeps list and detail routes independently addressable.
	const detailOpen = /\/issues\/\d+$/.test(pathname);

	return (
		<ThreadSplitView
			detail={detailOpen ? <Outlet /> : undefined}
			list={
				<>
					<Toolbar>
						<ThreadSearchBox
							value={q}
							onSearch={setQuery}
							placeholder="Search issues… (is:open label:bug author:you)"
							ariaLabel="Search issues"
						/>
						<div className="flex items-center gap-2">
							<Link
								to="/$owner/$name/labels"
								params={{ owner, name }}
								className={buttonVariants({ variant: "outline" })}
							>
								<Tag aria-hidden="true" />
								Labels
							</Link>
							<Link
								to="/$owner/$name/milestones"
								params={{ owner, name }}
								className={buttonVariants({ variant: "outline" })}
							>
								<Milestone aria-hidden="true" />
								Milestones
							</Link>
							{!session?.user ? (
								<SignInButton>Sign in to create an issue</SignInButton>
							) : (
								<Link
									to="/$owner/$name/issues/new/choose"
									params={{ owner, name }}
									className={buttonVariants()}
								>
									New issue
								</Link>
							)}
						</div>
					</Toolbar>

					{(search.noAssignee || search.assignees.length > 0) && (
						<p className="text-sm text-muted-foreground">
							{search.noAssignee
								? "Unassigned issues"
								: `Assigned to ${search.assignees.join(", ")}`}{" "}
							<button
								type="button"
								onClick={() => setQuery(withoutSearchAssignee(q))}
								className="text-foreground"
							>
								Clear filter
							</button>
						</p>
					)}

					<ThreadList
						header={
							<ThreadFilters
								q={q}
								repoId={repo?.id}
								tabs={ISSUE_STATUS_TABS}
								loadedCount={issues?.length ?? 0}
								onQueryChange={setQuery}
							/>
						}
						threads={issues}
						isLoading={isLoading}
						emptyMessage={`No ${activeTab !== "all" ? activeTab : ""} issues found.`}
						emptyAction={
							session?.user ? (
								<Link
									to="/$owner/$name/issues/new/choose"
									params={{ owner, name }}
									className={buttonVariants()}
								>
									Create first issue
								</Link>
							) : (
								<SignInButton>Sign in to create an issue</SignInButton>
							)
						}
					>
						{(issue) => (
							<ThreadRow kind="issue" owner={owner} name={name} thread={issue}>
								{issue.assignees.length > 0 && (
									<span className="min-w-0 break-words">
										assigned to{" "}
										{issue.assignees.map((a) => a.user.username).join(", ")}
									</span>
								)}
							</ThreadRow>
						)}
					</ThreadList>
				</>
			}
		/>
	);
}
