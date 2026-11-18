import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ current: null as { id: string } | null }));
const forkRepository = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		...props
	}: {
		to: string;
		params: Record<string, string>;
		children: React.ReactNode;
		[key: string]: unknown;
	}) => {
		const href = Object.entries(params).reduce(
			(url, [key, value]) => url.replace(`$${key}`, value),
			to,
		);
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	},
	useNavigate: () => navigate,
}));

vi.mock("@/lib/query-options", () => ({
	authSessionQueryOptions: () => ({
		queryKey: ["auth", "session"],
		queryFn: async () => (session.current ? { user: session.current } : null),
	}),
	queryKeys: {
		repositoriesRoot: ["repositories"],
		repositoryByName: (owner: string, name: string) => [
			"repositories",
			"by-name",
			owner,
			name,
		],
		repoFilesRoot: (repoId: number) => ["repos", repoId, "files"],
		repoCommitsRoot: (repoId: number) => ["repos", repoId, "commits"],
		repoBranches: (repoId: number) => ["repos", repoId, "branches"],
		repoPullRequestNumbers: (repoId: number) => [
			"repos",
			repoId,
			"pull-request-numbers",
		],
	},
}));

vi.mock("@/server/repositories", () => ({ forkRepository }));

import { ToastProvider } from "@/components/toast-provider";
import { ForkedFrom } from "../ForkedFrom";
import { RepoFork } from "../RepoFork";

const repo = {
	id: 7,
	forksCount: 3,
	viewerFork: null as { name: string; owner: { username: string } } | null,
	viewerNameTaken: false,
};

function renderFork(props: Partial<typeof repo> = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<RepoFork owner="owner" name="app.web" repo={{ ...repo, ...props }} />
			</ToastProvider>
		</QueryClientProvider>,
	);
}

describe("RepoFork", () => {
	it("forks into the viewer's account and opens the new fork", async () => {
		session.current = { id: "u1" };
		forkRepository.mockResolvedValue({
			name: "app.web",
			owner: { username: "forker" },
		});
		renderFork();

		const button = await screen.findByRole("button", { name: /Fork/ });
		await waitFor(() => expect(button).toBeEnabled());
		await userEvent.click(button);

		expect(forkRepository.mock.calls[0]?.[0]).toEqual({ data: { repoId: 7 } });
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/$owner/$name",
				params: { owner: "forker", name: "app.web" },
			}),
		);
		session.current = null;
	});

	it("links to the existing fork instead of forking again", async () => {
		session.current = { id: "u1" };
		renderFork({
			viewerFork: { name: "app.web", owner: { username: "forker" } },
			viewerNameTaken: false,
		});

		const link = await screen.findByTitle("Your fork: forker/app.web");
		expect(link.tagName).toBe("A");
		expect(link).toHaveAttribute("href", "/forker/app.web");
		expect(forkRepository).not.toHaveBeenCalled();
		session.current = null;
	});

	it("is disabled when the viewer owns a repository of that name", async () => {
		session.current = { id: "u1" };
		renderFork({ viewerNameTaken: true });

		expect(await screen.findByRole("button", { name: /Fork/ })).toBeDisabled();
		session.current = null;
	});

	it("is disabled for a signed-out viewer", async () => {
		session.current = null;
		renderFork();

		expect(await screen.findByRole("button", { name: /Fork/ })).toBeDisabled();
	});

	it("links the fork count to the forks list", async () => {
		session.current = { id: "u1" };
		renderFork();

		expect(
			await screen.findByRole("link", { name: "3 forks" }),
		).toHaveAttribute("href", "/owner/app.web/forks");
		session.current = null;
	});
});

describe("ForkedFrom", () => {
	it("names the parent and links the forks list", () => {
		render(
			<ForkedFrom
				owner="forker"
				name="app.web"
				parent={{ name: "app", owner: { username: "owner" } }}
				forksCount={2}
			/>,
		);

		expect(screen.getByText(/forked from/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "owner/app" })).toHaveAttribute(
			"href",
			"/owner/app",
		);
		expect(screen.getByRole("link", { name: /2 forks/ })).toHaveAttribute(
			"href",
			"/forker/app.web/forks",
		);
	});

	it("renders nothing when the repository is not a fork and has none", () => {
		const { container } = render(
			<ForkedFrom owner="owner" name="app" parent={null} forksCount={0} />,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
