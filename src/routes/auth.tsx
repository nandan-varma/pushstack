import { createFileRoute, Outlet } from "@tanstack/react-router";
import { redirectAuthenticatedUser } from "@/lib/route-auth";

export const Route = createFileRoute("/auth")({
	component: AuthLayout,
	beforeLoad: async ({ context }) => {
		await redirectAuthenticatedUser(context.queryClient);
	},
});

function AuthLayout() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--gradient-1)] via-[var(--gradient-2)] to-[var(--gradient-3)] p-4">
			<Outlet />
		</div>
	);
}
