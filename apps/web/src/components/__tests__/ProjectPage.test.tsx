import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/toast-provider";
import { Route } from "@/routes/users.$login.projects.$number";

const searchItems = vi.hoisted(() => vi.fn());
vi.mock("@/lib/query-options", () => ({
	queryKeys: { userProjectRoot: () => ["project"] },
	userProjectQueryOptions: (
		_login: string,
		_number: number,
		q: string,
		page: number,
		sort: string,
		dir: string,
	) => ({
		queryKey: ["project", q, page, sort, dir],
		queryFn: async () => ({
			project: {
				title: "Roadmap",
				number: 3,
				ownerLogin: "alice",
				public: true,
				closed: false,
			},
			canWrite: false,
			fields: [
				{ id: 1, name: "Status", dataType: "SINGLE_SELECT", options: [] },
			],
			items: [],
			itemCount: 100,
			page,
			pageCount: 2,
		}),
	}),
	projectAddableItemsQueryOptions: () => ({
		queryKey: ["addable"],
		queryFn: searchItems,
	}),
}));
vi.mock("@/server/projects", () => ({
	addUserProjectItem: vi.fn(),
	clearUserProjectItemFieldValue: vi.fn(),
	setUserProjectItemFieldValue: vi.fn(),
	updateUserProjectDraft: vi.fn(),
	createUserProjectField: vi.fn(),
	updateUserProjectField: vi.fn(),
}));

async function renderPage() {
	const root = createRootRoute();
	const routeOptions = {
		...Route.options,
		getParentRoute: () => root,
		path: "/users/$login/projects/$number",
		id: "/users/$login/projects/$number",
	};
	const projectRoute = Route.update(routeOptions);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const router = createRouter({
		routeTree: root.addChildren([projectRoute]),
		context: { queryClient },
		history: createMemoryHistory({
			initialEntries: [
				"/users/alice/projects/3?view=board&group=Status&sort=updated&dir=desc&by=points",
			],
		}),
	});
	await router.load();
	render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<RouterProvider router={router} />
			</ToastProvider>
		</QueryClientProvider>,
	);
	await screen.findByRole("heading", { name: /Roadmap/ });
	return router;
}

test("public readers never request owner-only addable items", async () => {
	await renderPage();
	expect(searchItems).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();
});

test("filtering and paging preserve board grouping and sort in the URL", async () => {
	const user = userEvent.setup();
	const router = await renderPage();
	const next = screen.getByRole("link", { name: "Next" });
	const href = new URL(next.getAttribute("href") ?? "", "http://localhost");
	expect(Object.fromEntries(href.searchParams)).toMatchObject({
		view: "board",
		group: "Status",
		sort: "updated",
		dir: "desc",
		by: "points",
		page: "2",
	});
	await user.type(
		screen.getByRole("searchbox", { name: "Filter project items" }),
		"ship{Enter}",
	);
	await waitFor(() =>
		expect(router.state.location.search).toMatchObject({
			q: "ship",
			view: "board",
			group: "Status",
			sort: "updated",
			dir: "desc",
			by: "points",
		}),
	);
	expect(router.state.location.search.page).toBeUndefined();
});
