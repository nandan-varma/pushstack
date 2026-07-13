import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useCallback, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FilterTabs } from "@/components/FilterTabs";
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
	): { status?: PullStatus } => ({
		status: (PULL_STATUS_VALUES.includes(search.status as PullStatus)
			? search.status
			: undefined) as PullStatus | undefined,
	}),
	loaderDeps: ({ search }) => ({
		status: search.status ?? ("open" as PullStatus),
	}),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await Promise.all([
				queryClient.ensureQueryData(repositoryBranchesQueryOptions(repo.id)),
				queryClient.ensureQueryData(
					repositoryPullRequestsQueryOptions({
						repoId: repo.id,
						status: deps.status,
					}),
				),
			]);
		}
	},
	component: PullRequestsPage,
});

const statusVariant = (status: string): "success" | "info" | "default" =>
	status === "open" ? "success" : status === "merged" ? "info" : "default";

function PullRequestsPage() {
	const { owner, name } = Route.useParams();
	const { status: filter } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: session } = useQuery(authSessionQueryOptions());
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPR, setNewPR] = useState({
		title: "",
		body: "",
		baseBranch: "main",
		headBranch: "",
	});

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: pullRequests, isLoading } = useQuery({
		...repositoryPullRequestsQueryOptions({
			repoId: repo?.id ?? 0,
			status: filter ?? "open",
		}),
		enabled: !!repo,
	});

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	const createMutation = useMutation({
		mutationFn: createPullRequest,
		onSuccess: async () => {
			if (!repo) return;
			await queryClient.invalidateQueries({
				queryKey: queryKeys.pullRequestsRoot(repo.id),
			});
			setIsCreateOpen(false);
			setNewPR({ title: "", body: "", baseBranch: "main", headBranch: "" });
			toast("Pull request created", "success");
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
				targetBranchName: newPR.baseBranch,
			},
		});
	}, [
		newPR.title,
		newPR.body,
		newPR.headBranch,
		newPR.baseBranch,
		repo,
		createMutation,
	]);

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between gap-4">
				<h2 className="text-base font-semibold text-[var(--sea-ink)]">
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
								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-1.5">
										<Label htmlFor="base">Base branch</Label>
										<select
											id="base"
											value={newPR.baseBranch}
											onChange={(e) =>
												setNewPR((p) => ({ ...p, baseBranch: e.target.value }))
											}
											className="flex h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
										>
											{branches?.map((b) => (
												<option key={b.name} value={b.name}>
													{b.name}
												</option>
											))}
										</select>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="head">Compare branch</Label>
										<select
											id="head"
											value={newPR.headBranch}
											onChange={(e) =>
												setNewPR((p) => ({ ...p, headBranch: e.target.value }))
											}
											className="flex h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
										>
											<option value="">Select branch…</option>
											{branches
												?.filter((b) => b.name !== newPR.baseBranch)
												.map((b) => (
													<option key={b.name} value={b.name}>
														{b.name}
													</option>
												))}
										</select>
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
									onClick={() => setIsCreateOpen(false)}
								>
									Cancel
								</Button>
								<Button
									onClick={handleCreatePR}
									disabled={
										!newPR.title.trim() ||
										!newPR.headBranch ||
										createMutation.isPending
									}
								>
									{createMutation.isPending
										? "Creating…"
										: "Create pull request"}
								</Button>
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
					// biome-ignore lint/suspicious/noExplicitAny: TanStack Router same-route navigate types are overly strict
					navigate({ search: { status: value } as any, replace: true })
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
					message={`No ${filter !== "all" ? filter : ""} pull requests found.`}
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
				<div className="overflow-hidden rounded-xl border border-[var(--line)]">
					{pullRequests.map((pr, idx) => (
						<Link
							key={pr.id}
							to="/repo/$owner/$name/pulls/$id"
							params={{ owner, name, id: pr.id.toString() }}
							className={`flex w-full items-start gap-4 p-4 text-left no-underline transition hover:bg-[var(--surface-strong)] ${idx < pullRequests.length - 1 ? "border-b border-[var(--line)]" : ""}`}
						>
							<div className="flex-1 space-y-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm font-medium text-[var(--sea-ink)]">
										{pr.title}
									</span>
									<Badge variant={statusVariant(pr.status)}>{pr.status}</Badge>
								</div>
								<p className="text-xs text-[var(--sea-ink-soft)]">
									#{pr.id} opened {new Date(pr.createdAt).toLocaleDateString()}{" "}
									by {pr.author?.name || "Unknown"} &middot;{" "}
									<code className="inline-flex items-center gap-1 font-mono">
										{pr.sourceBranch}
										<ArrowRight className="size-3" />
										{pr.targetBranch}
									</code>
								</p>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
