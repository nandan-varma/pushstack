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
		<div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-12">
			<Outlet />
		</div>
	);
}
