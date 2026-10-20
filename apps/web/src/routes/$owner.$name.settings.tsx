import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { NotFoundCard } from "@/components/NotFoundCard";
import { CollaboratorsSection } from "@/components/settings/CollaboratorsSection";
import { DangerSection } from "@/components/settings/DangerSection";
import { GeneralSection } from "@/components/settings/GeneralSection";
import { PerformanceSection } from "@/components/settings/PerformanceSection";
import {
	authSessionQueryOptions,
	repoCollaboratorsQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

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

		// Only the owner sees CollaboratorsSection; warm its list for them.
		if (repo && session?.user?.id === repo.ownerId) {
			queryClient
				.ensureQueryData(repoCollaboratorsQueryOptions(repo.id))
				.catch(() => {});
		}
	},
	component: RepoSettingsPage,
});

function RepoSettingsPage() {
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
			<div className="page-wrap px-4 py-10">
				<div className="mx-auto max-w-2xl space-y-4">
					{[1, 2, 3].map((i) => (
						<div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />
					))}
				</div>
			</div>
		);
	}

	if (!repo) {
		return (
			<div className="page-wrap px-4 py-16">
				<div className="mx-auto max-w-md">
					<NotFoundCard
						title="Repository not found"
						backTo="/repositories"
						backLabel="Back"
					/>
				</div>
			</div>
		);
	}

	const isOwner = repo.ownerId === session?.user?.id;
	if (!isOwner) {
		return (
			<div className="page-wrap px-4 py-10 text-center">
				<p className="text-muted-foreground">
					You don't have permission to view settings.
				</p>
			</div>
		);
	}

	return (
		<div className="page-wrap px-4 py-10">
			<div className="mx-auto max-w-2xl space-y-6">
				<div className="flex items-center justify-between gap-3">
					<Link
						to="/$owner/$name"
						params={{ owner, name }}
						className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					>
						<ArrowLeft className="size-4" />
						{owner}/{name}
					</Link>
					<Link
						to="/$owner/$name/setup"
						params={{ owner, name }}
						className="text-sm font-medium text-primary hover:underline"
					>
						View setup guide
					</Link>
				</div>
				<h1 className="text-2xl font-bold text-foreground">Settings</h1>

				<GeneralSection repo={repo} owner={owner} name={name} />
				<PerformanceSection repo={repo} owner={owner} name={name} />
				<CollaboratorsSection repoId={repo.id} />
				<DangerSection repo={repo} owner={owner} name={name} />
			</div>
		</div>
	);
}
