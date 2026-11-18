import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { BranchesSection } from "@/components/settings/BranchesSection";
import { repositoryByNameQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/settings/branches")({
	component: BranchesSettingsPage,
});

function BranchesSettingsPage() {
	const { owner, name } = Route.useParams();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	if (!repo) return null;

	return (
		<SettingsLayout
			title="Branch protection"
			actions={
				<Link
					to="/$owner/$name/settings"
					params={{ owner, name }}
					className="text-sm text-bjork-text-muted hover:text-bjork-accent"
				>
					← Repository settings
				</Link>
			}
			sections={[
				{
					id: "branches",
					label: "Branch protection",
					content: <BranchesSection repoId={repo.id} />,
				},
			]}
		/>
	);
}
