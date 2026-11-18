import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { NotFoundCard } from "@/components/NotFoundCard";
import { Skeleton } from "@/components/ui/skeleton";
import { backgroundQuery } from "@/lib/prefetch";
import {
	authSessionQueryOptions,
	repoCollaboratorsQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

/** Settings is owner-only: the guard runs once for every `/settings` page. */
export const Route = createFileRoute("/$owner/$name/settings")({
	loader: async ({ params, context: { queryClient } }) => {
		const [repo, session] = await Promise.all([
			queryClient.ensureQueryData(
				repositoryByNameQueryOptions({
					owner: params.owner,
					name: params.name,
				}),
			),
			queryClient.ensureQueryData(authSessionQueryOptions()),
		]);

		if (repo && session?.user?.id === repo.ownerId) {
			backgroundQuery(queryClient, repoCollaboratorsQueryOptions(repo.id));
		}
	},
	component: RepoSettingsLayout,
});

function RepoSettingsLayout() {
	const { owner, name } = Route.useParams();
	const { data: session, isLoading: sessionLoading } = useQuery(
		authSessionQueryOptions(),
	);
	const { data: repo, isLoading: repoLoading } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	// Both queries run in parallel (no `enabled` gating between them), but the
	// owner check below needs both to have settled — otherwise it can briefly
	// read a not-yet-loaded session as "not the owner" and flash the wrong UI.
	if (repoLoading || sessionLoading) {
		return (
			<div className="grid gap-6 lg:grid-cols-[200px_minmax(0,760px)]">
				<Skeleton className="h-8 w-48" />
				<div className="space-y-4">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-40 rounded-[18px]" />
					))}
				</div>
			</div>
		);
	}

	if (!repo) {
		return (
			<div className="mx-auto max-w-md py-6">
				<NotFoundCard
					title="Repository not found"
					backTo="/repositories"
					backLabel="Back"
				/>
			</div>
		);
	}

	if (repo.ownerId !== session?.user?.id) {
		return (
			<EmptyState
				icon={<Lock />}
				title="Settings are for the owner"
				message="Only this repository's owner can change its settings."
			/>
		);
	}

	return <Outlet />;
}
