import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AppShell } from "../shell/AppShell";

vi.mock("../shell/Sidebar", () => ({
	Sidebar: () => <nav>App navigation</nav>,
}));
vi.mock("@/lib/query-options", () => ({
	authSessionQueryOptions: () => ({
		queryKey: ["session"],
		queryFn: async () => null,
	}),
}));

test("keeps the current layout until the destination page commits", async () => {
	let finish!: () => void;
	const waiting = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const root = createRootRoute({
		component: () => (
			<AppShell>
				<Outlet />
			</AppShell>
		),
	});
	const home = createRoute({
		getParentRoute: () => root,
		path: "/",
		component: () => <h1>Home page</h1>,
	});
	const destination = createRoute({
		getParentRoute: () => root,
		path: "/dashboard",
		loader: () => waiting,
		component: () => <h1>Dashboard page</h1>,
	});
	const router = createRouter({
		routeTree: root.addChildren([home, destination]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	render(
		<QueryClientProvider client={new QueryClient()}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	await screen.findByRole("heading", { name: "Home page" });
	let navigation!: Promise<void>;
	await act(async () => {
		navigation = router.navigate({ to: "/dashboard" });
	});
	expect(
		screen.getByRole("heading", { name: "Home page" }),
	).toBeInTheDocument();
	expect(screen.queryByText("App navigation")).not.toBeInTheDocument();
	await act(async () => {
		finish();
		await navigation;
	});
	expect(
		screen.getByRole("heading", { name: "Dashboard page" }),
	).toBeInTheDocument();
	expect(screen.getByText("App navigation")).toBeInTheDocument();
});
