import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { AccessTokensSection } from "@/components/settings/AccessTokensSection";
import { DeveloperSection } from "@/components/settings/DeveloperSection";
import { EmailSection } from "@/components/settings/EmailSection";
import { PasswordSection } from "@/components/settings/PasswordSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { SessionsSection } from "@/components/settings/SessionsSection";
import { authSessionQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/settings")({
	// Cache the session in the query client (rather than calling getSession()
	// directly) so the component's useQuery below reads it instantly instead
	// of firing a second, duplicate fetch and rendering blank in the meantime.
	beforeLoad: async ({ context: { queryClient } }) => {
		const session = await queryClient.ensureQueryData(
			authSessionQueryOptions(),
		);
		if (!session?.user) throw redirect({ to: "/login" });
	},
	component: SettingsPage,
});

function SettingsPage() {
	const { data: session } = useQuery(authSessionQueryOptions());
	const user = session?.user;

	if (!user || !session) return null;

	return (
		<div className="page-wrap py-6">
			<SettingsLayout
				title="Settings"
				sections={[
					{
						id: "profile",
						label: "Profile",
						content: <ProfileSection name={user.name} email={user.email} />,
					},
					{
						id: "email",
						label: "Email",
						content: <EmailSection currentEmail={user.email} />,
					},
					{ id: "password", label: "Password", content: <PasswordSection /> },
					{
						id: "sessions",
						label: "Sessions",
						content: <SessionsSection currentToken={session.session.token} />,
					},
					{
						id: "tokens",
						label: "Access tokens",
						content: <AccessTokensSection />,
					},
					{
						id: "developer",
						label: "Developer",
						content: <DeveloperSection />,
					},
				]}
			/>
		</div>
	);
}
