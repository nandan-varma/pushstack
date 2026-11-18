import { createFileRoute, Outlet } from "@tanstack/react-router";

/** The gist section's shell: the index and every gist page render inside it. */
export const Route = createFileRoute("/gist")({
	component: () => <Outlet />,
});
