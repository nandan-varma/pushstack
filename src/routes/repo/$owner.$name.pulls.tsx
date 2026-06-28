import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useState } from "react";
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
	queryKeys,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryPullRequestsQueryOptions,
} from "@/lib/query-options";
import { createPullRequest } from "@/server/issues";

const PULL_STATUS_VALUES = ["open", "closed", "merged", "all"] as const;
type PullStatus = (typeof PULL_STATUS_VALUES)[number];

export const Route = createFileRoute("/repo/$owner/$name/pulls")({
	validateSearch: (search: Record<string, unknown>): { status?: PullStatus } => ({
		status: (PULL_STATUS_VALUES.includes(search.status as PullStatus)
			? search.status
			: undefined) as PullStatus | undefined,
	}),
	loaderDeps: ({ search }) => ({ status: search.status ?? ("open" as PullStatus) }),
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

const filterTabBase = "border-b-2 pb-3 text-sm font-medium transition";
const filterTabActive = "border-[var(--lagoon-deep)] text-[var(--lagoon-deep)]";
const filterTabInactive =
	"border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]";

const statusVariant = (status: string): "success" | "info" | "default" =>
	status === "open" ? "success" : status === "merged" ? "info" : "default";

function PullRequestsPage() {
	const { owner, name } = Route.useParams();
	const { status: filter } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
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
		},
	});

	const counts = {
		open: pullRequests?.filter((p) => p.status === "open").length || 0,
		merged: pullRequests?.filter((p) => p.status === "merged").length || 0,
		closed: pullRequests?.filter((p) => p.status === "closed").length || 0,
		all: pullRequests?.length || 0,
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
							<Button variant="outline" onClick={() => setIsCreateOpen(false)}>
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
								{createMutation.isPending ? "Creating…" : "Create pull request"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			{/* Filter tabs */}
			<div className="flex items-center gap-5 border-b border-[var(--line)]">
				{(
					[
						["open", `Open (${counts.open})`],
						["merged", `Merged (${counts.merged})`],
						["closed", `Closed (${counts.closed})`],
						["all", `All (${counts.all})`],
					] as const
				).map(([value, label]) => (
					<button
						key={value}
						type="button"
						className={`${filterTabBase} ${filter === value ? filterTabActive : filterTabInactive}`}
						onClick={() =>
							// biome-ignore lint/suspicious/noExplicitAny: TanStack Router same-route navigate types are overly strict
							navigate({ search: { status: value } as any, replace: true })
						}
					>
						{label}
					</button>
				))}
			</div>

			{/* PR list */}
			{isLoading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-16" />
					))}
				</div>
			) : !pullRequests?.length ? (
				<div className="island-shell rounded-xl p-12 text-center">
					<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
						No {filter !== "all" ? filter : ""} pull requests found.
					</p>
					<Button size="sm" onClick={() => setIsCreateOpen(true)}>
						Create first pull request
					</Button>
				</div>
			) : (
				<div className="overflow-hidden rounded-xl border border-[var(--line)]">
					{pullRequests.map((pr, idx) => (
						<button
							type="button"
							key={pr.id}
							className={`flex w-full items-start gap-4 p-4 text-left transition hover:bg-[var(--surface-strong)] ${idx < pullRequests.length - 1 ? "border-b border-[var(--line)]" : ""}`}
							onClick={() =>
								navigate({
									to: "/repo/$owner/$name/pulls/$id",
									params: { owner, name, id: pr.id.toString() },
								})
							}
						>
							<div className="flex-1 space-y-1">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-[var(--sea-ink)]">
										{pr.title}
									</span>
									<Badge variant={statusVariant(pr.status)}>{pr.status}</Badge>
								</div>
								<p className="text-xs text-[var(--sea-ink-soft)]">
									#{pr.id} opened{" "}
									{formatDistanceToNow(new Date(pr.createdAt), {
										addSuffix: true,
									})}{" "}
									by {pr.author?.name || "Unknown"} &middot;{" "}
									<code className="font-mono">
										{pr.sourceBranch} → {pr.targetBranch}
									</code>
								</p>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
