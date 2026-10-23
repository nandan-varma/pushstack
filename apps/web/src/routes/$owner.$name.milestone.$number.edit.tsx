import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { MilestoneForm } from "@/components/milestone/MilestoneForm";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/toast-provider";
import { Skeleton } from "@/components/ui/skeleton";
import {
	milestoneQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { updateMilestone } from "@/server/milestones";

export const Route = createFileRoute("/$owner/$name/milestone/$number/edit")({
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
	component: EditMilestonePage,
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

function EditMilestonePage() {
	const { owner, name, number: rawNumber } = Route.useParams();
	const number = Number(rawNumber);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data } = useQuery({
		...milestoneQueryOptions(repo?.id ?? 0, number),
		enabled: !!repo,
	});
	const goBack = () =>
		navigate({
			to: "/$owner/$name/milestone/$number",
			params: { owner, name, number: rawNumber },
		});
	const update = useMutation({
		mutationFn: updateMilestone,
		onSuccess: async () => {
			if (repo) {
				await queryClient.invalidateQueries({
					queryKey: queryKeys.repoMilestones(repo.id),
				});
				// Titles are copied into thread views, so refresh those too.
				await queryClient.invalidateQueries({
					queryKey: ["repos", owner, name],
				});
			}
			await goBack();
		},
		onError: (err: Error) => toast(err.message, "error"),
	});
	return (
		<div className="space-y-4">
			<PageHeader title="Edit milestone" />
			<div className="island-shell rounded-[20px] p-5">
				{!data || !repo ? (
					<Skeleton className="h-32" />
				) : !data.viewer.canWrite ? (
					<p className="text-sm text-muted-foreground">
						You need write access to edit milestones.
					</p>
				) : (
					<MilestoneForm
						initial={data.milestone}
						submitLabel="Save changes"
						pending={update.isPending}
						onCancel={goBack}
						onSubmit={(draft) =>
							update.mutate({
								data: {
									repoId: repo.id,
									number,
									title: draft.title,
									description: draft.description,
									dueOn: draft.dueOn,
								},
							})
						}
					/>
				)}
			</div>
		</div>
	);
}
