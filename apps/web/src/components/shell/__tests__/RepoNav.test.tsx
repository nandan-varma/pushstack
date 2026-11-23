import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RepoNav } from "../RepoNav";

vi.mock("@/lib/query-options", () => ({
	repositoryByNameQueryOptions: () => ({
		queryKey: ["repository"],
		queryFn: async () => null,
		staleTime: Infinity,
	}),
	authSessionQueryOptions: () => ({
		queryKey: ["session"],
		queryFn: async () => null,
		staleTime: Infinity,
	}),
}));
vi.mock("@/components/repo/RepoWatch", () => ({ RepoWatch: () => null }));
vi.mock("@/components/repo/RepoStar", () => ({ RepoStar: () => null }));
vi.mock("@/components/repo/RepoFork", () => ({ RepoFork: () => null }));
vi.mock("@/components/repo/SyncFork", () => ({ SyncFork: () => null }));

async function renderNavigation({
	wiki = false,
	hasIssues = true,
	branch = "main",
} = {}) {
	const root = createRootRoute();
	const route = createRoute({
		getParentRoute: () => root,
		path: wiki ? "/$owner/$name/wiki/$" : "/$owner/$name/tree/$branch/$",
		component: () => <RepoNav owner="owner" name="project" />,
	});
	const router = createRouter({
		routeTree: root.addChildren([route]),
		history: createMemoryHistory({
			initialEntries: [
				wiki
					? "/owner/project/wiki/Home"
					: `/owner/project/tree/${encodeURIComponent(branch)}/`,
			],
		}),
	});
	const queryClient = new QueryClient();
	queryClient.setQueryData(["session"], null);
	queryClient.setQueryData(["repository"], {
		ownerId: "owner-id",
		defaultBranch: "main",
		visibility: "public",
		topics: [],
		forksCount: 0,
		hasWiki: true,
		hasIssues,
		hasDiscussions: false,
		viewer: { canWrite: false },
	});
	await router.load();
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

test("repository pages offer one labeled clone URL and copy its value", async () => {
	const user = userEvent.setup();
	const writeClipboard = vi.spyOn(navigator.clipboard, "writeText");
	await renderNavigation();

	expect(screen.getByText("Clone repository")).toBeInTheDocument();
	expect(screen.getAllByRole("textbox")).toHaveLength(1);
	const field = screen.getByRole("textbox", { name: "clone URL" });
	expect(field).toHaveValue("http://localhost:3000/owner/project.git");
	expect(
		screen.queryByRole("button", { name: "Copy wiki clone URL" }),
	).toBeNull();
	await user.click(screen.getByRole("button", { name: "Copy clone URL" }));
	expect(writeClipboard).toHaveBeenCalledWith(
		(field as HTMLInputElement).value,
	);
});

test("wiki pages offer the wiki clone URL instead of a second clone field", async () => {
	await renderNavigation({ wiki: true });

	expect(screen.getByText("Clone wiki")).toBeInTheDocument();
	expect(screen.getAllByRole("textbox")).toHaveLength(1);
	expect(screen.getByRole("textbox", { name: "wiki clone URL" })).toHaveValue(
		"http://localhost:3000/owner/project.wiki.git",
	);
	expect(
		screen.getByRole("button", { name: "Copy wiki clone URL" }),
	).toBeVisible();
	expect(screen.queryByRole("button", { name: "Copy clone URL" })).toBeNull();
});

test("ZIP download is a button-styled download for the selected branch", async () => {
	await renderNavigation({ branch: "feature/docs" });

	const download = screen.getByRole("link", { name: "Download ZIP" });
	expect(download).toHaveAttribute(
		"href",
		"/owner/project/archive/feature/docs.zip",
	);
	expect(download).toHaveAttribute("download");
	expect(download).toHaveClass("inline-flex", "w-full", "border-border");
});

test("disabled repository features are absent from navigation", async () => {
	await renderNavigation({ hasIssues: false });

	expect(screen.queryByRole("link", { name: "Issues" })).toBeNull();
	expect(screen.queryByRole("link", { name: "Discussions" })).toBeNull();
});
