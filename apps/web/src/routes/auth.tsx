import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth-session";

export const Route = createFileRoute("/auth")({
	component: AuthLayout,
	beforeLoad: async () => {
		const session = await getSession();
		if (session?.user) {
			throw redirect({ to: "/dashboard" });
		}
	},
});

function AuthLayout() {
	return (
		<div className="flex flex-1 items-center justify-center px-4 py-12">
			<Outlet />
		</div>
	);
}
