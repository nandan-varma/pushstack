import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FilterTabs } from "@/components/FilterTabs";
import { LabelChip } from "@/components/LabelChip";
import { LabelFilter } from "@/components/LabelFilter";
import { issueStatusVariant } from "@/components/status-variants";
import { ThreadSearchBox } from "@/components/ThreadSearchBox";
import { useToast } from "@/components/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MAX_SEARCH_QUERY_CHARS } from "@/lib/limits";
import {
	authSessionQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssueSearchQueryOptions,
} from "@/lib/query-options";
import {
	parseSearchQuery,
	withoutSearchAssignee,
	withSearchLabel,
	withSearchStatus,
} from "@/lib/search-query";
import { createIssue } from "@/server/issues";

export const Route = createFileRoute("/repo/$owner/$name/issues")({
	validateSearch: (search: Record<string, unknown>): { q?: string } => ({
		// The URL query string is the single source of truth (GitHub's `?q=`).
		q:
			typeof search.q === "string" && search.q
				? search.q.slice(0, MAX_SEARCH_QUERY_CHARS)
				: undefined,
	}),
	loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
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
	const [newIssue, setNewIssue] = useState({ title: "", body: "" });

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

	const createMutation = useMutation({
		mutationFn: createIssue,
		onSuccess: async () => {
			if (!repo) return;
			await queryClient.invalidateQueries({
				queryKey: queryKeys.repoIssuesRoot(repo.id),
			});
			setIsCreateOpen(false);
			setNewIssue({ title: "", body: "" });
			toast("Issue created", "success");
		},
		onError: (err: Error) => {
			toast(err.message || "Failed to create issue", "error");
		},
	});

	// The loaded page is the active tab's rows, so only its count is known.
	const activeTab: "open" | "closed" | "all" =
		search.status === "closed" || search.status === "all"
			? search.status
			: "open";
	const openCount = activeTab === "open" ? issues?.length || 0 : undefined;
	const closedCount = activeTab === "closed" ? issues?.length || 0 : undefined;
	const allCount = activeTab === "all" ? issues?.length || 0 : undefined;

	const handleCreateIssue = useCallback(() => {
		if (!newIssue.title.trim() || !repo) return;
		createMutation.mutate({
			data: {
				repoId: repo.id,
				title: newIssue.title,
				body: newIssue.body,
			},
		});
	}, [newIssue.title, newIssue.body, repo, createMutation]);

	// The issues list is the parent of /issues/:id. Rendering the detail
	// Outlet here keeps list and detail routes independently addressable.
	if (/\/issues\/\d+$/.test(pathname)) {
		return <Outlet />;
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-4">
					<h2 className="text-base font-semibold text-foreground">Issues</h2>
					<Link
						to="/repo/$owner/$name/labels"
						params={{ owner, name }}
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Labels
					</Link>
				</div>
				{!session?.user ? (
					<Link to="/auth/login">
						<Button size="sm" variant="outline">
							Sign in to create an issue
						</Button>
					</Link>
				) : (
					<Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
						<DialogTrigger asChild>
							<Button size="sm">New issue</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Create new issue</DialogTitle>
								<DialogDescription>
									Report a bug, request a feature, or start a discussion
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4">
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
							</div>
							<DialogFooter>
								<Button
									variant="outline"
									onClick={() => setIsCreateOpen(false)}
								>
									Cancel
								</Button>
								<Button
									onClick={handleCreateIssue}
									disabled={!newIssue.title.trim() || createMutation.isPending}
								>
									{createMutation.isPending ? "Creating…" : "Create issue"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</div>

			<ThreadSearchBox
				value={q}
				onSearch={setQuery}
				placeholder="Search issues… (is:open label:bug author:you)"
				ariaLabel="Search issues"
			/>

			<FilterTabs
				tabs={[
					{ value: "open" as const, label: "Open", count: openCount },
					{ value: "closed" as const, label: "Closed", count: closedCount },
					{ value: "all" as const, label: "All", count: allCount },
				]}
				activeTab={activeTab}
				onTabChange={(value) => setQuery(withSearchStatus(q, value))}
			/>

			<LabelFilter
				repoId={repo?.id}
				value={search.labels[0]}
				onChange={(value) => setQuery(withSearchLabel(q, value))}
			/>

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

			{/* Issues list */}
			{isLoading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-16" />
					))}
				</div>
			) : !issues?.length ? (
				<EmptyState
					message={`No ${activeTab !== "all" ? activeTab : ""} issues found.`}
					action={
						session?.user ? (
							<Button size="sm" onClick={() => setIsCreateOpen(true)}>
								Create first issue
							</Button>
						) : (
							<Link to="/auth/login">
								<Button size="sm" variant="outline">
									Sign in to create an issue
								</Button>
							</Link>
						)
					}
				/>
			) : (
				<div className="overflow-hidden rounded-xl border border-border">
					{issues.map((issue, idx) => (
						<Link
							key={issue.id}
							to="/repo/$owner/$name/issues/$id"
							params={{ owner, name, id: issue.number.toString() }}
							className={`flex w-full items-start gap-4 p-4 text-left no-underline transition hover:bg-card ${idx < issues.length - 1 ? "border-b border-border" : ""}`}
						>
							<div className="min-w-0 flex-1 space-y-1">
								<div className="flex min-w-0 items-center gap-2">
									<span className="min-w-0 truncate text-sm font-medium text-foreground">
										{issue.title}
									</span>
									<Badge
										className="shrink-0"
										variant={issueStatusVariant(issue.status)}
									>
										{issue.status}
									</Badge>
								</div>
								<p className="text-xs text-muted-foreground">
									#{issue.number} opened{" "}
									{new Date(issue.createdAt).toLocaleDateString()} by{" "}
									{issue.author.name}
									{issue.assignees.length > 0 &&
										` · assigned to ${issue.assignees.map((a) => a.user.username).join(", ")}`}
								</p>
								{issue.labels.length > 0 && (
									<div className="flex flex-wrap gap-1.5 pt-0.5">
										{issue.labels.map((l) => (
											<LabelChip key={l.id} {...l} />
										))}
									</div>
								)}
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
