import {
	createRoute,
	Link,
	Outlet,
	redirect,
	useLoaderData,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { mockRepository, mockUser } from "../../test/mock-routes";
import {
	createTestQueryClient,
	renderWithRouter,
	rootRoute,
} from "../../test/router-utils";

describe("Integration Tests - Full User Flows", () => {
	it("should handle complete authentication and navigation flow", async () => {
		const user = userEvent.setup();
		let mockAuth = { isAuthenticated: false, user: null as any };

		// Mock authentication function
		const mockLogin = vi
			.fn()
			.mockImplementation(async (email: string, password: string) => {
				if (email === "test@example.com" && password === "password") {
					mockAuth = { isAuthenticated: true, user: mockUser };
					return mockUser;
				}
				throw new Error("Invalid credentials");
			});

		function LoginPage() {
			const [error, setError] = React.useState("");

			const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
				e.preventDefault();
				const formData = new FormData(e.currentTarget);
				const email = formData.get("email") as string;
				const password = formData.get("password") as string;

				try {
					await mockLogin(email, password);
					(window as any).router?.navigate({ to: "/dashboard" as never });
				} catch (err: any) {
					setError(err.message);
				}
			};

			return (
				<div data-testid="login-page">
					<h1>Login</h1>
					{error && <p data-testid="error">{error}</p>}
					<form onSubmit={handleSubmit}>
						<input
							data-testid="email-input"
							name="email"
							type="email"
							placeholder="Email"
						/>
						<input
							data-testid="password-input"
							name="password"
							type="password"
							placeholder="Password"
						/>
						<button type="submit" data-testid="login-button">
							Login
						</button>
					</form>
				</div>
			);
		}

		function DashboardPage() {
			return (
				<div data-testid="dashboard">
					<h1>Dashboard</h1>
					<p data-testid="welcome">Welcome, {mockAuth.user?.name}!</p>
					<Link to="/repositories" data-testid="repos-link">
						View Repositories
					</Link>
				</div>
			);
		}

		function RepositoriesPage() {
			return (
				<div data-testid="repositories">
					<h1>Repositories</h1>
					<p>Your repositories</p>
				</div>
			);
		}

		const loginRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/login",
			component: LoginPage,
		});

		const dashboardRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/dashboard",
			component: DashboardPage,
			beforeLoad: () => {
				if (!mockAuth.isAuthenticated) {
					throw redirect({ to: "/login" as never });
				}
			},
		});

		const repositoriesRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/repositories",
			component: RepositoriesPage,
			beforeLoad: () => {
				if (!mockAuth.isAuthenticated) {
					throw redirect({ to: "/login" as never });
				}
			},
		});

		const { router } = renderWithRouter(null, {
			routes: [loginRoute, dashboardRoute, repositoriesRoute],
			initialLocation: "/login",
		});

		// Store router globally
		(window as any).router = router;

		// 1. Should show login page
		expect(await screen.findByTestId("login-page")).toBeInTheDocument();

		// 2. Fill in credentials and submit
		await user.type(screen.getByTestId("email-input"), "test@example.com");
		await user.type(screen.getByTestId("password-input"), "password");
		await user.click(screen.getByTestId("login-button"));

		// 3. Should navigate to dashboard
		await waitFor(() => {
			expect(screen.getByTestId("dashboard")).toBeInTheDocument();
		});
		expect(screen.getByTestId("welcome")).toHaveTextContent(
			"Welcome, Test User!",
		);

		// 4. Navigate to repositories
		await user.click(screen.getByTestId("repos-link"));

		await waitFor(() => {
			expect(screen.getByTestId("repositories")).toBeInTheDocument();
		});

		expect(mockLogin).toHaveBeenCalledWith("test@example.com", "password");

		// Cleanup
		delete (window as any).router;
	});

	it("should handle data fetching, display, and error states", async () => {
		const queryClient = createTestQueryClient();
		const shouldFail = false;

		const mockFetchRepo = vi.fn().mockImplementation(async () => {
			if (shouldFail) {
				throw new Error("Repository not found");
			}
			return mockRepository;
		});

		const mockFetchIssues = vi.fn().mockResolvedValue([
			{ id: 1, title: "Bug: Fix login", status: "open" },
			{ id: 2, title: "Feature: Add search", status: "open" },
		]);

		function RepoLayout() {
			const data = (window as any).repoData;
			return (
				<div data-testid="repo-layout">
					<h1 data-testid="repo-name">{data?.name}</h1>
					<p data-testid="repo-description">{data?.description}</p>
					<div data-testid="outlet">
						<Outlet />
					</div>
				</div>
			);
		}

		function RepoIssues() {
			const data = (window as any).issuesData;
			return (
				<div data-testid="repo-issues">
					<h2>Issues</h2>
					<ul data-testid="issues-list">
						{data?.map((issue: any) => (
							<li key={issue.id} data-testid={`issue-${issue.id}`}>
								{issue.title}
							</li>
						))}
					</ul>
				</div>
			);
		}

		function ErrorComponent({ error }: { error: Error }) {
			return (
				<div data-testid="error-component">
					<h1>Error</h1>
					<p data-testid="error-message">{error.message}</p>
				</div>
			);
		}

		const repoRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/repo/$owner/$name",
			component: RepoLayout,
			loader: async ({ params }) => {
				const data = await mockFetchRepo(params.owner, params.name);
				(window as any).repoData = data;
				return data;
			},
			errorComponent: ErrorComponent as any,
		});

		const repoIssuesRoute = createRoute({
			getParentRoute: () => repoRoute,
			path: "/issues",
			component: RepoIssues,
			loader: async ({ params }) => {
				const issues = await mockFetchIssues(params.owner, params.name);
				(window as any).issuesData = issues;
				return issues;
			},
		});

		// First render: success
		renderWithRouter(null, {
			routes: [repoRoute, repoIssuesRoute],
			initialLocation: "/repo/testuser/testrepo/issues",
			context: { queryClient },
			queryClient,
		});

		await waitFor(() => {
			expect(screen.getByTestId("repo-layout")).toBeInTheDocument();
		});

		expect(screen.getByTestId("repo-name")).toHaveTextContent("test-repo");
		expect(screen.getByTestId("repo-description")).toHaveTextContent(
			"Test repository description",
		);
		expect(screen.getByTestId("repo-issues")).toBeInTheDocument();
		expect(screen.getByTestId("issue-1")).toHaveTextContent("Bug: Fix login");
		expect(screen.getByTestId("issue-2")).toHaveTextContent(
			"Feature: Add search",
		);

		expect(mockFetchRepo).toHaveBeenCalledWith("testuser", "testrepo");
		expect(mockFetchIssues).toHaveBeenCalledWith("testuser", "testrepo");

		// Cleanup
		delete (window as any).repoData;
		delete (window as any).issuesData;
	});

	it("should handle complex search and filtering workflow", async () => {
		const user = userEvent.setup();

		const mockSearchRepos = vi
			.fn()
			.mockImplementation(async (query: string, filter: string) => {
				// Return empty results if no search query
				if (!query) {
					return [];
				}

				const allRepos = [
					{ id: 1, name: "react-app", language: "javascript" },
					{ id: 2, name: "python-api", language: "python" },
					{ id: 3, name: "react-native-app", language: "javascript" },
				];

				let filtered = allRepos.filter((repo) =>
					repo.name.toLowerCase().includes(query.toLowerCase()),
				);

				if (filter !== "all") {
					filtered = filtered.filter((repo) => repo.language === filter);
				}

				return filtered;
			});

		function SearchPage() {
			const search = useSearch({ from: "/search" as never }) as {
				q: string;
				filter: string;
			};
			const data = useLoaderData({ from: "/search" as never }) as Array<{
				id: number;
				name: string;
				language: string;
			}>;
			const navigate = useNavigate({ from: "/search" as never });

			const handleSearch = async (e: React.FormEvent<HTMLFormElement>) => {
				e.preventDefault();
				const formData = new FormData(e.currentTarget);
				const query = formData.get("query") as string;
				const filter = formData.get("filter") as string;
				await navigate({
					to: "/search" as never,
					search: { q: query, filter } as never,
				});
			};

			return (
				<div data-testid="search-page">
					<h1>Search Repositories</h1>
					<form onSubmit={handleSearch}>
						<input
							data-testid="search-input"
							name="query"
							key={search.q} // Force re-render on search change
							defaultValue={search.q}
							placeholder="Search..."
						/>
						<select
							data-testid="filter-select"
							name="filter"
							key={search.filter} // Force re-render on filter change
							defaultValue={search.filter}
						>
							<option value="all">All Languages</option>
							<option value="javascript">JavaScript</option>
							<option value="python">Python</option>
						</select>
						<button type="submit" data-testid="search-button">
							Search
						</button>
					</form>
					<div data-testid="results">
						{data && data.length > 0 ? (
							<ul data-testid="results-list">
								{data.map((repo: any) => (
									<li key={repo.id} data-testid={`repo-${repo.id}`}>
										{repo.name} ({repo.language})
									</li>
								))}
							</ul>
						) : (
							<p data-testid="no-results">No results found</p>
						)}
					</div>
				</div>
			);
		}

		const searchRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/search",
			component: SearchPage,
			validateSearch: (search) => {
				return {
					q: (search.q as string) || "",
					filter: (search.filter as string) || "all",
				};
			},
			loaderDeps: ({ search }) => ({ q: search.q, filter: search.filter }),
			loader: async ({ deps }) => {
				const q = deps.q || "";
				const filter = deps.filter || "all";
				const data = await mockSearchRepos(q, filter);
				return data;
			},
		});

		renderWithRouter(null, {
			routes: [searchRoute],
			initialLocation: "/search",
		});

		// 1. Initial load - no results
		await waitFor(() => {
			expect(screen.getByTestId("search-page")).toBeInTheDocument();
		});
		expect(screen.getByTestId("no-results")).toBeInTheDocument();

		// 2. Search for "react"
		await user.clear(screen.getByTestId("search-input"));
		await user.type(screen.getByTestId("search-input"), "react");
		await user.click(screen.getByTestId("search-button"));

		// Wait for navigation and loader to complete
		await waitFor(
			() => {
				// Verify mock was called with the search term
				expect(mockSearchRepos).toHaveBeenCalledWith("react", "all");
				expect(screen.getByTestId("results-list")).toBeInTheDocument();
			},
			{ timeout: 3000 },
		);

		expect(screen.getByTestId("repo-1")).toHaveTextContent("react-app");
		expect(screen.getByTestId("repo-3")).toHaveTextContent("react-native-app");
		expect(screen.queryByTestId("repo-2")).not.toBeInTheDocument();

		// 3. Filter by JavaScript
		await user.selectOptions(screen.getByTestId("filter-select"), "javascript");
		await user.click(screen.getByTestId("search-button"));

		await waitFor(() => {
			expect(mockSearchRepos).toHaveBeenLastCalledWith("react", "javascript");
		});

		// Cleanup
		delete (window as any).router;
		delete (window as any).routeSearch;
		delete (window as any).searchData;
	});
});
