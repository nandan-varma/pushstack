import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { FilterTabs } from "@/components/FilterTabs";
import { MilestoneProgress } from "@/components/milestone/MilestoneProgress";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PageHeader } from "@/components/PageHeader";
import { ThreadList, ThreadRow } from "@/components/thread-list/ThreadList";
import { useToast } from "@/components/toast-provider";
import { buttonVariants } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { formatDueOn, milestoneProgress } from "@/lib/milestone";
import {
	milestoneQueryOptions,
	milestoneThreadsQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { updateMilestone } from "@/server/milestones";

export const Route = createFileRoute("/$owner/$name/milestone/$number/")({
	loader: async ({ params, context: { queryClient } }) => {
		const number = Number(params.number);
		if (!Number.isInteger(number) || number < 1) throw notFound();
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(milestoneQueryOptions(repo.id, number));
		}
	},
	component: MilestonePage,
	notFoundComponent: MilestoneNotFound,
});

function MilestoneNotFound() {
	const { owner, name } = Route.useParams();
	return (
		<NotFoundCard
			title="Milestone Not Found"
			backTo="/$owner/$name/milestones"
			backParams={{ owner, name }}
			backLabel="Back to Milestones"
		/>
	);
}

function MilestonePage() {
	const { owner, name, number: rawNumber } = Route.useParams();
	const number = Number(rawNumber);
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [state, setState] = useState<"open" | "closed">("open");
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const repoId = repo?.id ?? 0;
	const { data } = useQuery({
		...milestoneQueryOptions(repoId, number),
		enabled: !!repo,
	});
	const { data: threads, isLoading } = useQuery({
		...milestoneThreadsQueryOptions(repoId, number, state),
		enabled: !!repo,
	});
	const toggle = useMutation({
		mutationFn: updateMilestone,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: queryKeys.repoMilestones(repoId),
			}),
		onError: (err: Error) => toast(err.message, "error"),
	});
	const milestone = data?.milestone;
	const canWrite = data?.viewer.canWrite ?? false;
	return (
		<div className="space-y-4">
			<PageHeader
				title={milestone?.title ?? "Milestone"}
				meta={milestone && `#${milestone.number}`}
				description={
					milestone &&
					`${milestone.state === "open" ? "Open" : "Closed"} · ${
						milestone.dueOn
							? `Due by ${formatDueOn(milestone.dueOn)}`
							: "No due date"
					}`
				}
				actions={
					<>
						<Link
							to="/$owner/$name/milestones"
							params={{ owner, name }}
							className={buttonVariants({ variant: "outline" })}
						>
							All milestones
						</Link>
						{canWrite && milestone && (
							<>
								<Link
									to="/$owner/$name/milestone/$number/edit"
									params={{ owner, name, number: rawNumber }}
									className={buttonVariants({ variant: "outline" })}
								>
									Edit
								</Link>
								<LoadingButton
									variant="outline"
									isLoading={toggle.isPending}
									loadingLabel="Saving…"
									onClick={() =>
										toggle.mutate({
											data: {
												repoId,
												number,
												state: milestone.state === "open" ? "closed" : "open",
											},
										})
									}
								>
									{milestone.state === "open" ? "Close" : "Reopen"}
								</LoadingButton>
							</>
						)}
					</>
				}
			/>
			{milestone && (
				<div className="space-y-2">
					<MilestoneProgress
						openIssues={milestone.openIssues}
						closedIssues={milestone.closedIssues}
					/>
					<p className="font-mono text-xs text-bjork-text-soft tabular-nums">
						{milestoneProgress(milestone.openIssues, milestone.closedIssues)}%
						complete
					</p>
					{milestone.description && (
						<p className="text-sm break-words whitespace-pre-wrap text-bjork-text-medium">
							{milestone.description}
						</p>
					)}
				</div>
			)}
			<ThreadList
				threads={threads}
				isLoading={isLoading || !repo}
				header={
					<FilterTabs
						variant="inline"
						label="Status"
						activeTab={state}
						onTabChange={setState}
						tabs={[
							{ value: "open", label: "Open", count: milestone?.openIssues },
							{
								value: "closed",
								label: "Closed",
								count: milestone?.closedIssues,
							},
						]}
					/>
				}
				emptyMessage={`No ${state} issues or pull requests in this milestone.`}
				emptyAction={null}
			>
				{(thread) => (
					<ThreadRow
						kind={thread.kind === "issue" ? "issue" : "pull"}
						owner={owner}
						name={name}
						thread={thread}
					/>
				)}
			</ThreadList>
		</div>
	);
}
