import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LiveRepoPreview } from "../LiveRepoPreview";

const { loadRepo, loadCommits } = vi.hoisted(() => ({
	loadRepo: vi.fn(),
	loadCommits: vi.fn(),
}));
vi.mock("@/lib/query-options", () => ({
	repositoryByNameQueryOptions: () => ({
		queryKey: ["demo-repo"],
		queryFn: loadRepo,
		retry: false,
	}),
	repositoryCommitsQueryOptions: () => ({
		queryKey: ["demo-commits"],
		queryFn: loadCommits,
		retry: false,
	}),
}));

async function renderPreview() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRootRoute();
	const home = createRoute({
		getParentRoute: () => root,
		path: "/",
		component: LiveRepoPreview,
	});
	const router = createRouter({
		routeTree: root.addChildren([home]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	const view = render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return { client, ...view };
}

test("a failed repository stays unavailable while a hovered route retries its shared query", async () => {
	loadRepo.mockRejectedValue(new Error("Repository unavailable"));
	const { client, container } = await renderPreview();
	await screen.findByText("This repository isn't available.");
	let finish!: () => void;
	loadRepo.mockImplementation(
		() =>
			new Promise((_, reject) => {
				finish = () => reject(new Error("Still unavailable"));
			}),
	);
	let preload!: Promise<void>;
	await act(async () => {
		preload = client.prefetchQuery({
			queryKey: ["demo-repo"],
			queryFn: loadRepo,
			retry: false,
		});
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(
		screen.getByText("This repository isn't available."),
	).toBeInTheDocument();
	expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
	await act(async () => {
		finish();
		await preload;
	});
});

test("an empty repository shows an empty state instead of a blank list", async () => {
	loadRepo.mockResolvedValue({ id: 1, defaultBranch: "main", starCount: 0 });
	loadCommits.mockResolvedValue([]);
	await renderPreview();
	await waitFor(() => expect(loadCommits).toHaveBeenCalled());
	expect(await screen.findByText("No commits yet.")).toBeInTheDocument();
});

test("a missing repository finishes loading and does not claim to be live", async () => {
	loadRepo.mockResolvedValue(null);
	await renderPreview();
	expect(
		await screen.findByText("This repository isn't available."),
	).toBeInTheDocument();
	expect(screen.queryByText("Live")).not.toBeInTheDocument();
});
