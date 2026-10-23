import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MilestoneForm } from "@/components/milestone/MilestoneForm";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/toast-provider";
import {
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryMilestonesQueryOptions,
} from "@/lib/query-options";
import { createMilestone } from "@/server/milestones";

export const Route = createFileRoute("/$owner/$name/milestones/new")({
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
	component: NewMilestonePage,
});

function NewMilestonePage() {
	const { owner, name } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data } = useQuery({
		...repositoryMilestonesQueryOptions(repo?.id ?? 0, "open"),
		enabled: !!repo,
	});
	const create = useMutation({
		mutationFn: createMilestone,
		onSuccess: async () => {
			if (repo) {
				await queryClient.invalidateQueries({
					queryKey: queryKeys.repoMilestones(repo.id),
				});
			}
			await navigate({
				to: "/$owner/$name/milestones",
				params: { owner, name },
			});
		},
		onError: (err: Error) => toast(err.message, "error"),
	});
	const canWrite = data?.viewer.canWrite ?? false;
	return (
		<div className="space-y-4">
			<PageHeader title="New milestone" />
			<div className="island-shell rounded-[20px] p-5">
				{data && !canWrite ? (
					<p className="text-sm text-muted-foreground">
						You need write access to create milestones.
					</p>
				) : (
					<MilestoneForm
						submitLabel="Create milestone"
						pending={create.isPending}
						onCancel={() =>
							navigate({
								to: "/$owner/$name/milestones",
								params: { owner, name },
							})
						}
						onSubmit={(draft) =>
							repo &&
							create.mutate({
								data: {
									repoId: repo.id,
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
