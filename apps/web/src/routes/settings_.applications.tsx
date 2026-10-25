import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { AuthorizedAppsSection } from "@/components/settings/AuthorizedAppsSection";
import { authSessionQueryOptions } from "@/lib/query-options";

/** /settings/applications: the OAuth apps with access to the account, and revocation. */
export const Route = createFileRoute("/settings_/applications")({
	beforeLoad: async ({ context: { queryClient } }) => {
		const session = await queryClient.ensureQueryData(
			authSessionQueryOptions(),
		);
		if (!session?.user) throw redirect({ to: "/login" });
	},
	component: ApplicationsPage,
});

function ApplicationsPage() {
	return (
		<div className="page-wrap py-6">
			<SettingsLayout
				title="Applications"
				sections={[
					{
						id: "applications",
						label: "Authorized OAuth apps",
						content: <AuthorizedAppsSection />,
					},
				]}
			/>
		</div>
	);
}
