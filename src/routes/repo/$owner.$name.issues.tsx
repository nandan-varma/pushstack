import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FilterTabs } from "@/components/FilterTabs";
import { LabelChip } from "@/components/LabelChip";
import { LabelFilter } from "@/components/LabelFilter";
import { issueStatusVariant } from "@/components/status-variants";
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
import {
	authSessionQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssuesQueryOptions,
} from "@/lib/query-options";
import { createIssue } from "@/server/issues";

const STATUS_VALUES = ["open", "closed", "all"] as const;
type IssueStatus = (typeof STATUS_VALUES)[number];

export const Route = createFileRoute("/repo/$owner/$name/issues")({
	validateSearch: (
		search: Record<string, unknown>,
	): { status?: IssueStatus; label?: string } => ({
		status: (STATUS_VALUES.includes(search.status as IssueStatus)
			? search.status
			: undefined) as IssueStatus | undefined,
		label:
			typeof search.label === "string" && search.label
				? search.label
				: undefined,
	}),
	loaderDeps: ({ search }) => ({
		status: search.status ?? ("open" as IssueStatus),
		label: search.label,
	}),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(
				repositoryIssuesQueryOptions({
					repoId: repo.id,
					status: deps.status,
					labels: deps.label ? [deps.label] : [],
				}),
			);
		}
	},
	component: IssuesPage,
});

function IssuesPage() {
	const { owner, name } = Route.useParams();
	const { status: filter, label } = Route.useSearch();
	const { pathname } = useLocation();
	const navigate = useNavigate({ from: Route.fullPath });
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newIssue, setNewIssue] = useState({ title: "", body: "" });

	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: issues, isLoading } = useQuery({
		...repositoryIssuesQueryOptions({
			repoId: repo?.id ?? 0,
			status: filter ?? "open",
			labels: label ? [label] : [],
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

	const openCount = filter === "open" ? issues?.length || 0 : undefined;
	const closedCount = filter === "closed" ? issues?.length || 0 : undefined;
	const allCount = filter === "all" ? issues?.length || 0 : undefined;

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

			<FilterTabs
				tabs={[
					{ value: "open" as const, label: "Open", count: openCount },
					{ value: "closed" as const, label: "Closed", count: closedCount },
					{ value: "all" as const, label: "All", count: allCount },
				]}
				activeTab={filter ?? "open"}
				onTabChange={(value) =>
					navigate({
						search: (prev) => ({ ...prev, status: value }),
						replace: true,
					})
				}
			/>

			<LabelFilter
				repoId={repo?.id}
				value={label}
				onChange={(value) =>
					navigate({
						search: (prev) => ({ ...prev, label: value }),
						replace: true,
					})
				}
			/>

			{/* Issues list */}
			{isLoading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-16" />
					))}
				</div>
			) : !issues?.length ? (
				<EmptyState
					message={`No ${(filter ?? "open") !== "all" ? (filter ?? "open") : ""} issues found.`}
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
