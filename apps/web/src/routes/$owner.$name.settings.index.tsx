import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { CollaboratorsSection } from "@/components/settings/CollaboratorsSection";
import { DangerSection } from "@/components/settings/DangerSection";
import { GeneralSection } from "@/components/settings/GeneralSection";
import { PerformanceSection } from "@/components/settings/PerformanceSection";
import {
	authSessionQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/settings/")({
	component: RepoSettingsPage,
});

function RepoSettingsPage() {
	const { owner, name } = Route.useParams();
	// The layout route above has loaded and guarded both; these reads hit the
	// query cache it filled.
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	if (!repo || repo.ownerId !== session?.user?.id) return null;

	return (
		<SettingsLayout
			title="Repository settings"
			actions={
				<Link
					to="/$owner/$name/settings/branches"
					params={{ owner, name }}
					className="text-sm text-bjork-text-muted hover:text-bjork-accent"
				>
					Branch protection →
				</Link>
			}
			sections={[
				{
					id: "general",
					label: "General",
					content: <GeneralSection repo={repo} owner={owner} name={name} />,
				},
				{
					id: "performance",
					label: "Performance",
					content: <PerformanceSection repo={repo} owner={owner} name={name} />,
				},
				{
					id: "collaborators",
					label: "Collaborators",
					content: <CollaboratorsSection repoId={repo.id} />,
				},
				{
					id: "danger",
					label: "Danger zone",
					danger: true,
					content: <DangerSection repo={repo} owner={owner} name={name} />,
				},
			]}
		/>
	);
}
