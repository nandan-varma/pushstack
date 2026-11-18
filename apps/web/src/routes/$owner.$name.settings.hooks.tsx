import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { WebhooksSettings } from "@/components/repo/settings/WebhooksSettings";
import { repositoryByNameQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/settings/hooks")({
	component: WebhooksSettingsPage,
});

function WebhooksSettingsPage() {
	const { owner, name } = Route.useParams();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	if (!repo) return null;

	return (
		<SettingsLayout
			title="Webhooks"
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
					id: "hooks",
					label: "Webhooks",
					content: <WebhooksSettings repoId={repo.id} />,
				},
			]}
		/>
	);
}
