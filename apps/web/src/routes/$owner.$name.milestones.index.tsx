import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Milestone } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FilterTabs } from "@/components/FilterTabs";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { MilestoneProgress } from "@/components/milestone/MilestoneProgress";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/toast-provider";
import { buttonVariants } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDueOn, milestoneProgress } from "@/lib/milestone";
import {
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryMilestonesQueryOptions,
} from "@/lib/query-options";
import {
	deleteMilestone,
	type getMilestones,
	updateMilestone,
} from "@/server/milestones";

export const Route = createFileRoute("/$owner/$name/milestones/")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(
				repositoryMilestonesQueryOptions(repo.id, "open"),
			);
		}
	},
	component: MilestonesPage,
});

type MilestoneRowData = Awaited<
	ReturnType<typeof getMilestones>
>["milestones"][number];

function MilestoneRow({
	milestone,
	owner,
	name,
	repoId,
	canWrite,
}: {
	milestone: MilestoneRowData;
	owner: string;
	name: string;
	repoId: number;
	canWrite: boolean;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.repoMilestones(repoId),
		});
	const toggle = useMutation({
		mutationFn: updateMilestone,
		onSuccess: refresh,
		onError: (err: Error) => toast(err.message, "error"),
	});
	const remove = useMutation({
		mutationFn: deleteMilestone,
		onSuccess: refresh,
		onError: (err: Error) => toast(err.message, "error"),
	});
	const params = { owner, name, number: String(milestone.number) };
	return (
		<li className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
			<div className="min-w-0 space-y-1">
				<Link
					to="/$owner/$name/milestone/$number"
					params={params}
					className="text-sm font-semibold text-bjork-text hover:text-bjork-accent"
				>
					{milestone.title}
				</Link>
				<p className="text-xs text-bjork-text-soft">
					{milestone.dueOn
						? `Due by ${formatDueOn(milestone.dueOn)}`
						: "No due date"}
				</p>
				{milestone.description && (
					<p className="line-clamp-2 text-sm break-words whitespace-pre-wrap text-bjork-text-medium">
						{milestone.description}
					</p>
				)}
			</div>
			<div className="space-y-2">
				<MilestoneProgress
					openIssues={milestone.openIssues}
					closedIssues={milestone.closedIssues}
				/>
				<p className="font-mono text-xs text-bjork-text-soft tabular-nums">
					{milestoneProgress(milestone.openIssues, milestone.closedIssues)}%
					complete &middot; {milestone.openIssues} open &middot;{" "}
					{milestone.closedIssues} closed
				</p>
				{canWrite && (
					<div className="flex flex-wrap items-center gap-2">
						<Link
							to="/$owner/$name/milestone/$number/edit"
							params={params}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							Edit
						</Link>
						<LoadingButton
							variant="outline"
							size="sm"
							isLoading={toggle.isPending}
							loadingLabel="Saving…"
							onClick={() =>
								toggle.mutate({
									data: {
										repoId,
										number: milestone.number,
										state: milestone.state === "open" ? "closed" : "open",
									},
								})
							}
						>
							{milestone.state === "open" ? "Close" : "Reopen"}
						</LoadingButton>
						<LoadingButton
							variant="destructive"
							size="sm"
							isLoading={remove.isPending}
							loadingLabel="Deleting…"
							onClick={() => {
								if (
									window.confirm(
										`Delete the "${milestone.title}" milestone? It is removed from every issue and pull request.`,
									)
								) {
									remove.mutate({
										data: { repoId, number: milestone.number },
									});
								}
							}}
						>
							Delete
						</LoadingButton>
					</div>
				)}
			</div>
		</li>
	);
}

function MilestonesPage() {
	const { owner, name } = Route.useParams();
	const [state, setState] = useState<"open" | "closed">("open");
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data, isLoading } = useQuery({
		...repositoryMilestonesQueryOptions(repo?.id ?? 0, state),
		enabled: !!repo,
	});
	const canWrite = data?.viewer.canWrite ?? false;
	return (
		<div className="space-y-4">
			<PageHeader
				title="Milestones"
				actions={
					<>
						<Link
							to="/$owner/$name/issues"
							params={{ owner, name }}
							className={buttonVariants({ variant: "outline" })}
						>
							Issues
						</Link>
						{canWrite && (
							<Link
								to="/$owner/$name/milestones/new"
								params={{ owner, name }}
								className={buttonVariants()}
							>
								New milestone
							</Link>
						)}
					</>
				}
			/>
			<Panel>
				<PanelHeader>
					<FilterTabs
						variant="inline"
						label="Milestone state"
						activeTab={state}
						onTabChange={setState}
						tabs={[
							{ value: "open", label: "Open", count: data?.counts.open },
							{ value: "closed", label: "Closed", count: data?.counts.closed },
						]}
					/>
				</PanelHeader>
				{isLoading || !repo ? (
					<Skeleton className="m-5 h-16" />
				) : data?.milestones.length ? (
					<ul className="divide-y divide-bjork-border-muted">
						{data.milestones.map((milestone) => (
							<MilestoneRow
								key={milestone.id}
								milestone={milestone}
								owner={owner}
								name={name}
								repoId={repo.id}
								canWrite={canWrite}
							/>
						))}
					</ul>
				) : (
					<EmptyState
						bare
						icon={<Milestone aria-hidden="true" />}
						message={`No ${state} milestones.`}
						action={
							canWrite && state === "open" ? (
								<Link
									to="/$owner/$name/milestones/new"
									params={{ owner, name }}
									className={buttonVariants()}
								>
									New milestone
								</Link>
							) : undefined
						}
					/>
				)}
			</Panel>
		</div>
	);
}
