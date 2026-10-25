import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { OAuthAppsSection } from "@/components/settings/OAuthAppsSection";
import { authSessionQueryOptions } from "@/lib/query-options";

/** /settings/developers: register OAuth apps. Sits outside /settings's nesting. */
export const Route = createFileRoute("/settings_/developers")({
	beforeLoad: async ({ context: { queryClient } }) => {
		const session = await queryClient.ensureQueryData(
			authSessionQueryOptions(),
		);
		if (!session?.user) throw redirect({ to: "/login" });
	},
	component: DevelopersPage,
});

function DevelopersPage() {
	return (
		<div className="page-wrap py-6">
			<SettingsLayout
				title="Developer settings"
				sections={[
					{
						id: "oauth-apps",
						label: "OAuth apps",
						content: <OAuthAppsSection />,
					},
				]}
			/>
		</div>
	);
}
