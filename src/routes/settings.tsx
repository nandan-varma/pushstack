import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
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
		if (!session?.user) throw redirect({ to: "/auth/login" });
	},
	component: SettingsPage,
});

function SettingsPage() {
	const { data: session } = useQuery(authSessionQueryOptions());
	const user = session?.user;

	if (!user || !session) return null;

	return (
		<div className="page-wrap px-4 py-10">
			<div className="mx-auto max-w-2xl space-y-10">
				<h1 className="text-2xl font-bold text-foreground">Account settings</h1>
				<SettingsGroup title="Account">
					<ProfileSection name={user.name} email={user.email} />
					<EmailSection currentEmail={user.email} />
				</SettingsGroup>
				<SettingsGroup title="Security">
					<PasswordSection />
					<SessionsSection currentToken={session.session.token} />
				</SettingsGroup>
				<SettingsGroup title="Git access">
					<AccessTokensSection />
				</SettingsGroup>
				<SettingsGroup title="Developer">
					<DeveloperSection />
				</SettingsGroup>
			</div>
		</div>
	);
}

function SettingsGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-4">
			<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</h2>
			{children}
		</section>
	);
}
