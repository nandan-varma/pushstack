import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useMatch,
	useNavigate,
} from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useCallback, useState } from "react";
import { Toolbar } from "@/components/layout/page";
import { ThreadSearchBox } from "@/components/ThreadSearchBox";
import { NewThreadDialog } from "@/components/thread-list/NewThreadDialog";
import {
	activeThreadTab,
	PULL_REQUEST_STATUS_TABS,
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
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { backgroundQuery } from "@/lib/prefetch";
import {
	authSessionQueryOptions,
	queryKeys,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryPullRequestSearchQueryOptions,
} from "@/lib/query-options";
import { createPullRequest } from "@/server/pull-requests";

/**
 * The pull request list, and the split-view parent of a pull request: GitHub
 * lists at `/{owner}/{repo}/pulls` but shows one at `/{owner}/{repo}/pull/{n}`,
 * so both live under this pathless layout.
 */
export const Route = createFileRoute("/$owner/$name/_pulls")({
	validateSearch: validateThreadSearch,
	loaderDeps: threadSearchDeps,
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo) return;

		// Branches only feed the "new PR" source/target selectors, not the list
		// itself — fire-and-forget (same pattern as the tree page's loader) so
		// a slow cold branch listing doesn't block the page from rendering the
		// PR list, which is already fetched separately below.
		backgroundQuery(queryClient, repositoryBranchesQueryOptions(repo.id));
		await queryClient.ensureQueryData(
			repositoryPullRequestSearchQueryOptions({
				repoId: repo.id,
				query: deps.q,
			}),
		);
	},
	component: PullRequestsPage,
});

function PullRequestsPage() {
	const { owner, name } = Route.useParams();
	const { q = "" } = Route.useSearch();
	const detail = useMatch({
		from: "/$owner/$name/_pulls/pull/$id/{-$tab}",
		shouldThrow: false,
	});
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [isDraft, setIsDraft] = useState(false);
	const [newPR, setNewPR] = useState<{
		title: string;
		body: string;
		baseBranch: string | null;
		headBranch: string;
	}>({ title: "", body: "", baseBranch: null, headBranch: "" });
	const baseBranch = newPR.baseBranch ?? repo?.defaultBranch ?? "";

	const { data: pullRequests, isLoading } = useQuery({
		...repositoryPullRequestSearchQueryOptions({
			repoId: repo?.id ?? 0,
			query: q,
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
			// The sidebar shows open counts from the repository row.
			queryClient.invalidateQueries({
				queryKey: queryKeys.repositoryByName(owner, name),
			});
			setIsCreateOpen(false);
			setIsDraft(false);
			setNewPR({
				title: "",
				body: "",
				baseBranch: null,
				headBranch: "",
			});
			toast("Pull request created", "success");
			navigate({
				to: "/$owner/$name/pull/$id/{-$tab}",
				params: { owner, name, id: String(pr.number) },
			});
		},
		onError: (err: Error) => {
			toast(err.message || "Failed to create pull request", "error");
		},
	});

	const setQuery = useCallback(
		(next: string) => {
			navigate({
				to: "/$owner/$name/pulls",
				params: { owner, name },
				search: { q: next || undefined },
				replace: true,
			});
		},
		[navigate, owner, name],
	);

	const activeTab = activeThreadTab(q, PULL_REQUEST_STATUS_TABS);

	const handleCreatePR = useCallback(() => {
		if (!newPR.title.trim() || !newPR.headBranch || !repo) return;
		createMutation.mutate({
			data: {
				repoId: repo.id,
				title: newPR.title,
				body: newPR.body,
				sourceBranchName: newPR.headBranch,
				targetBranchName: baseBranch,
				draft: isDraft,
			},
		});
	}, [
		isDraft,
		newPR.title,
		newPR.body,
		newPR.headBranch,
		baseBranch,
		repo,
		createMutation,
	]);

	const detailOpen = Boolean(detail);
	// A diff or commit list needs the full width; the conversation splits.
	const tab = detail?.params.tab;

	return (
		<ThreadSplitView
			detail={detailOpen ? <Outlet /> : undefined}
			wide={Boolean(tab)}
			list={
				<>
					<Toolbar>
						<ThreadSearchBox
							value={q}
							onSearch={setQuery}
							placeholder="Search pull requests… (is:open label:bug author:you)"
							ariaLabel="Search pull requests"
						/>
						<div className="flex items-center gap-2">
							{!session?.user ? (
								<SignInButton>Sign in to open a pull request</SignInButton>
							) : (
								<NewThreadDialog
									open={isCreateOpen}
									onOpenChange={setIsCreateOpen}
									triggerLabel="New pull request"
									title="Create pull request"
									description="Merge changes from one branch into another"
									submitLabel="Create pull request"
									canSubmit={!!newPR.title.trim() && !!newPR.headBranch}
									isPending={createMutation.isPending}
									onSubmit={handleCreatePR}
								>
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
									<div className="flex items-center gap-2">
										<Switch
											id="draft"
											checked={isDraft}
											onCheckedChange={setIsDraft}
										/>
										<Label htmlFor="draft">Create as draft</Label>
									</div>
								</NewThreadDialog>
							)}
						</div>
					</Toolbar>

					<ThreadList
						header={
							<ThreadFilters
								q={q}
								repoId={repo?.id}
								tabs={PULL_REQUEST_STATUS_TABS}
								loadedCount={pullRequests?.length ?? 0}
								onQueryChange={setQuery}
							/>
						}
						threads={pullRequests}
						isLoading={isLoading}
						emptyMessage={`No ${activeTab !== "all" ? activeTab : ""} pull requests found.`}
						emptyAction={
							session?.user ? (
								<Button onClick={() => setIsCreateOpen(true)}>
									Create first pull request
								</Button>
							) : (
								<SignInButton>Sign in to open a pull request</SignInButton>
							)
						}
					>
						{(pr) => (
							<ThreadRow kind="pull" owner={owner} name={name} thread={pr}>
								<span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 font-mono break-all">
									{pr.sourceBranch}
									<ArrowRight className="size-3 shrink-0" aria-hidden="true" />
									{pr.targetBranch}
								</span>
							</ThreadRow>
						)}
					</ThreadList>
				</>
			}
		/>
	);
}
