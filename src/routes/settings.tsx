import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { EmailSection } from "@/components/settings/EmailSection";
import { PasswordSection } from "@/components/settings/PasswordSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
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

	if (!user) return null;

	return (
		<div className="page-wrap px-4 py-10">
			<div className="mx-auto max-w-2xl space-y-6">
				<h1 className="text-2xl font-bold text-[var(--sea-ink)]">
					Account settings
				</h1>
				<ProfileSection name={user.name} email={user.email} />
				<EmailSection currentEmail={user.email} />
				<PasswordSection />
			</div>
		</div>
	);
}
