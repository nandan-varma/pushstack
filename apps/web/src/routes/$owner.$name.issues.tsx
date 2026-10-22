import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ThreadSearchBox } from "@/components/ThreadSearchBox";
import { NewThreadDialog } from "@/components/thread-list/NewThreadDialog";
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
import {
	threadSearchDeps,
	validateThreadSearch,
} from "@/components/thread-list/thread-search";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ASSIGNEES } from "@/lib/limits";
import {
	assignableUsersQueryOptions,
	authSessionQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssueSearchQueryOptions,
} from "@/lib/query-options";
import { parseSearchQuery, withoutSearchAssignee } from "@/lib/search-query";
import { createIssue } from "@/server/issues";

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
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newIssue, setNewIssue] = useState({
		title: "",
		body: "",
		assignees: [] as string[],
	});

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

	const { data: assignable } = useQuery({
		...assignableUsersQueryOptions(repo?.id ?? 0),
		enabled: !!repo?.viewer.canWrite && isCreateOpen,
	});
	const createMutation = useMutation({
		mutationFn: createIssue,
		onSuccess: async () => {
			if (!repo) return;
			await queryClient.invalidateQueries({
				queryKey: queryKeys.repoIssuesRoot(repo.id),
			});
			setIsCreateOpen(false);
			setNewIssue({ title: "", body: "", assignees: [] });
			toast("Issue created", "success");
		},
		onError: (err: Error) => {
			toast(err.message || "Failed to create issue", "error");
		},
	});

	const activeTab = activeThreadTab(q, ISSUE_STATUS_TABS);

	const handleCreateIssue = useCallback(() => {
		if (!newIssue.title.trim() || !repo) return;
		createMutation.mutate({
			data: {
				repoId: repo.id,
				title: newIssue.title,
				body: newIssue.body,
				assignees: newIssue.assignees,
			},
		});
	}, [newIssue.title, newIssue.body, newIssue.assignees, repo, createMutation]);

	// The issues list is the parent of /issues/:id. Rendering the detail
	// Outlet here keeps list and detail routes independently addressable.
	if (/\/issues\/\d+$/.test(pathname)) {
		return <Outlet />;
	}

	return (
		<div className="space-y-4">
			<PageHeader
				size="compact"
				title="Issues"
				actions={
					<>
						<Link
							to="/$owner/$name/labels"
							params={{ owner, name }}
							className="text-sm text-muted-foreground hover:text-foreground"
						>
							Labels
						</Link>
						{!session?.user ? (
							<SignInButton>Sign in to create an issue</SignInButton>
						) : (
							<NewThreadDialog
								open={isCreateOpen}
								onOpenChange={setIsCreateOpen}
								triggerLabel="New issue"
								title="Create new issue"
								description="Report a bug, request a feature, or start a discussion"
								submitLabel="Create issue"
								canSubmit={!!newIssue.title.trim()}
								isPending={createMutation.isPending}
								onSubmit={handleCreateIssue}
							>
								<div className="space-y-1.5">
									<Label htmlFor="title">Title</Label>
									<Input
										id="title"
										value={newIssue.title}
										onChange={(e) =>
											setNewIssue((p) => ({ ...p, title: e.target.value }))
										}
										placeholder="Issue title"
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="body">Description</Label>
									<Textarea
										id="body"
										value={newIssue.body}
										onChange={(e) =>
											setNewIssue((p) => ({ ...p, body: e.target.value }))
										}
										placeholder="Describe the issue in detail…"
										rows={6}
									/>
								</div>
								{repo?.viewer.canWrite && (
									<fieldset className="space-y-2">
										<legend className="text-sm font-medium">Assignees</legend>
										{(assignable ?? []).map((person) => (
											<label
												key={person.id}
												className="flex items-center gap-2 text-sm"
											>
												<input
													type="checkbox"
													disabled={
														createMutation.isPending ||
														(!newIssue.assignees.includes(person.username) &&
															newIssue.assignees.length >= MAX_ASSIGNEES)
													}
													checked={newIssue.assignees.includes(person.username)}
													onChange={(e) =>
														setNewIssue((p) => ({
															...p,
															assignees: e.target.checked
																? [...p.assignees, person.username]
																: p.assignees.filter(
																		(name) => name !== person.username,
																	),
														}))
													}
												/>
												{person.username}
											</label>
										))}
									</fieldset>
								)}
							</NewThreadDialog>
						)}
					</>
				}
			/>

			<div className="space-y-3">
				<ThreadSearchBox
					value={q}
					onSearch={setQuery}
					placeholder="Search issues… (is:open label:bug author:you)"
					ariaLabel="Search issues"
				/>

				<ThreadFilters
					q={q}
					repoId={repo?.id}
					tabs={ISSUE_STATUS_TABS}
					loadedCount={issues?.length ?? 0}
					onQueryChange={setQuery}
				/>
			</div>

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
				threads={issues}
				isLoading={isLoading}
				emptyMessage={`No ${activeTab !== "all" ? activeTab : ""} issues found.`}
				emptyAction={
					session?.user ? (
						<Button onClick={() => setIsCreateOpen(true)}>
							Create first issue
						</Button>
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
		</div>
	);
}
