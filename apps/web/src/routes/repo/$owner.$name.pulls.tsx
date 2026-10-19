import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useCallback, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FilterTabs } from "@/components/FilterTabs";
import { LabelChip } from "@/components/LabelChip";
import { LabelFilter } from "@/components/LabelFilter";
import { pullRequestStatusVariant } from "@/components/status-variants";
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
import { LoadingButton } from "@/components/ui/loading-button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
	authSessionQueryOptions,
	queryKeys,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryPullRequestsQueryOptions,
} from "@/lib/query-options";
import { createPullRequest } from "@/server/pull-requests";

const PULL_STATUS_VALUES = ["open", "closed", "merged", "all"] as const;
type PullStatus = (typeof PULL_STATUS_VALUES)[number];

export const Route = createFileRoute("/repo/$owner/$name/pulls")({
	validateSearch: (
		search: Record<string, unknown>,
	): { status?: PullStatus; label?: string } => ({
		status: (PULL_STATUS_VALUES.includes(search.status as PullStatus)
			? search.status
			: undefined) as PullStatus | undefined,
		label:
			typeof search.label === "string" && search.label
				? search.label
				: undefined,
	}),
	loaderDeps: ({ search }) => ({
		status: search.status ?? ("open" as PullStatus),
		label: search.label,
	}),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo) return;

		// Branches only feed the "new PR" source/target selectors, not the list
		// itself — fire-and-forget (same pattern as the tree page's loader) so
		// a slow cold branch listing doesn't block the page from rendering the
		// PR list, which is already fetched separately below.
		queryClient
			.ensureQueryData(repositoryBranchesQueryOptions(repo.id))
			.catch(() => {});
		await queryClient.ensureQueryData(
			repositoryPullRequestsQueryOptions({
				repoId: repo.id,
				status: deps.status,
				labels: deps.label ? [deps.label] : [],
			}),
		);
	},
	component: PullRequestsPage,
});

function PullRequestsPage() {
	const { owner, name } = Route.useParams();
	const { status: filter, label } = Route.useSearch();
	const { pathname } = useLocation();
	const navigate = useNavigate({ from: Route.fullPath });
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	// baseBranch null = the repo's default branch, whenever it's known.
	const [newPR, setNewPR] = useState<{
		title: string;
		body: string;
		baseBranch: string | null;
		headBranch: string;
	}>({ title: "", body: "", baseBranch: null, headBranch: "" });
	const baseBranch = newPR.baseBranch ?? repo?.defaultBranch ?? "";

	const { data: pullRequests, isLoading } = useQuery({
		...repositoryPullRequestsQueryOptions({
			repoId: repo?.id ?? 0,
			status: filter ?? "open",
			labels: label ? [label] : [],
		}),
		enabled: !!repo,
	});

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	const createMutation = useMutation({
		mutationFn: createPullRequest,
		onSuccess: async (pr) => {
			if (!repo) return;
			await queryClient.invalidateQueries({
				queryKey: queryKeys.pullRequestsRoot(repo.id),
			});
			setIsCreateOpen(false);
			setNewPR({
				title: "",
				body: "",
				baseBranch: null,
				headBranch: "",
			});
			toast("Pull request created", "success");
			navigate({
				to: "/repo/$owner/$name/pulls/$id",
				params: { owner, name, id: String(pr.number) },
			});
		},
		onError: (err: Error) => {
			toast(err.message || "Failed to create pull request", "error");
		},
	});

	const counts = {
		open: filter === "open" ? pullRequests?.length || 0 : undefined,
		merged: filter === "merged" ? pullRequests?.length || 0 : undefined,
		closed: filter === "closed" ? pullRequests?.length || 0 : undefined,
		all: filter === "all" ? pullRequests?.length || 0 : undefined,
	};

	const handleCreatePR = useCallback(() => {
		if (!newPR.title.trim() || !newPR.headBranch || !repo) return;
		createMutation.mutate({
			data: {
				repoId: repo.id,
				title: newPR.title,
				body: newPR.body,
				sourceBranchName: newPR.headBranch,
				targetBranchName: baseBranch,
			},
		});
	}, [
		newPR.title,
		newPR.body,
		newPR.headBranch,
		baseBranch,
		repo,
		createMutation,
	]);

	// This route is both the PR list and the parent of the PR detail route.
	// Render the child on /pulls/:id rather than leaving the list mounted with
	// no Outlet, which made every PR link appear to do nothing.
	if (/\/pulls\/\d+$/.test(pathname)) {
		return <Outlet />;
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-base font-semibold text-foreground">
					Pull Requests
				</h2>
				{!session?.user ? (
					<Link to="/auth/login">
						<Button size="sm" variant="outline">
							Sign in to open a pull request
						</Button>
					</Link>
				) : (
					<Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
						<DialogTrigger asChild>
							<Button size="sm">New pull request</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Create pull request</DialogTitle>
								<DialogDescription>
									Merge changes from one branch into another
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4">
								<div className="space-y-1.5">
									<Label htmlFor="title">Title</Label>
									<Input
										id="title"
										value={newPR.title}
										onChange={(e) =>
											setNewPR((p) => ({ ...p, title: e.target.value }))
										}
										placeholder="Pull request title"
									/>
								</div>
								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<div className="space-y-1.5">
										<Label htmlFor="base">Base branch</Label>
										<Select
											value={baseBranch}
											onValueChange={(value) =>
												setNewPR((p) => ({ ...p, baseBranch: value }))
											}
										>
											<SelectTrigger id="base" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{branches?.map((b) => (
													<SelectItem key={b.name} value={b.name}>
														{b.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="head">Compare branch</Label>
										<Select
											value={newPR.headBranch}
											onValueChange={(value) =>
												setNewPR((p) => ({ ...p, headBranch: value }))
											}
										>
											<SelectTrigger id="head" className="w-full">
												<SelectValue placeholder="Select branch…" />
											</SelectTrigger>
											{/* alignItemWithTrigger positions the popup by aligning the
											*selected* item over the trigger — with no branch chosen
											yet (headBranch starts as ""), there's no selected item to
											align against, which left the option(s) rendered with a
											zero-size bounding box (unclickable, and any pointer event
											that reached the popup at all fell through to the dialog's
											own outside-click handler and closed the whole dialog).
											Disabling it here falls back to normal anchored
											positioning below the trigger. */}
											<SelectContent alignItemWithTrigger={false}>
												{branches
													?.filter((b) => b.name !== baseBranch)
													.map((b) => (
														<SelectItem key={b.name} value={b.name}>
															{b.name}
														</SelectItem>
													))}
											</SelectContent>
										</Select>
									</div>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="body">Description</Label>
									<Textarea
										id="body"
										value={newPR.body}
										onChange={(e) =>
											setNewPR((p) => ({ ...p, body: e.target.value }))
										}
										placeholder="Describe your changes…"
										rows={5}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button
									variant="outline"
									disabled={createMutation.isPending}
									onClick={() => setIsCreateOpen(false)}
								>
									Cancel
								</Button>
								<LoadingButton
									onClick={handleCreatePR}
									disabled={!newPR.title.trim() || !newPR.headBranch}
									isLoading={createMutation.isPending}
									loadingLabel="Creating…"
								>
									Create pull request
								</LoadingButton>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</div>

			<FilterTabs
				tabs={[
					{ value: "open" as const, label: "Open", count: counts.open },
					{ value: "merged" as const, label: "Merged", count: counts.merged },
					{ value: "closed" as const, label: "Closed", count: counts.closed },
					{ value: "all" as const, label: "All", count: counts.all },
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

			{/* PR list */}
			{isLoading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-16" />
					))}
				</div>
			) : !pullRequests?.length ? (
				<EmptyState
					message={`No ${(filter ?? "open") !== "all" ? (filter ?? "open") : ""} pull requests found.`}
					action={
						session?.user ? (
							<Button size="sm" onClick={() => setIsCreateOpen(true)}>
								Create first pull request
							</Button>
						) : (
							<Link to="/auth/login">
								<Button size="sm" variant="outline">
									Sign in to open a pull request
								</Button>
							</Link>
						)
					}
				/>
			) : (
				<div className="overflow-hidden rounded-xl border border-border">
					{pullRequests.map((pr, idx) => (
						<Link
							key={pr.id}
							to="/repo/$owner/$name/pulls/$id"
							params={{ owner, name, id: pr.number.toString() }}
							className={`flex w-full items-start gap-4 p-4 text-left no-underline transition hover:bg-card ${idx < pullRequests.length - 1 ? "border-b border-border" : ""}`}
						>
							<div className="min-w-0 flex-1 space-y-1">
								<div className="flex min-w-0 items-center gap-2">
									<span className="min-w-0 truncate text-sm font-medium text-foreground">
										{pr.title}
									</span>
									<Badge
										className="shrink-0"
										variant={pullRequestStatusVariant(pr.status)}
									>
										{pr.status}
									</Badge>
								</div>
								<p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
									<span>
										#{pr.number} opened{" "}
										{new Date(pr.createdAt).toLocaleDateString()} by{" "}
										{pr.author.name}
									</span>
									<span className="hidden sm:inline">&middot;</span>
									<code className="inline-flex items-center gap-1 font-mono">
										{pr.sourceBranch}
										<ArrowRight className="size-3" />
										{pr.targetBranch}
									</code>
								</p>
								{pr.labels.length > 0 && (
									<div className="flex flex-wrap gap-1.5 pt-0.5">
										{pr.labels.map((l) => (
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
