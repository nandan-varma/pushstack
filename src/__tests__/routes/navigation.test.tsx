import { createRoute, Link } from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithRouter, rootRoute } from "../../test/router-utils";

describe("Route Navigation", () => {
	it("should navigate when link is clicked", async () => {
		const user = userEvent.setup();

		function HomePage() {
			return (
				<div>
					<h1>Home</h1>
					<Link to="/about" data-testid="about-link">
						About
					</Link>
				</div>
			);
		}

		function AboutPage() {
			return <h1>About Page</h1>;
		}

		const homeRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: HomePage,
		});

		const aboutRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/about",
			component: AboutPage,
		});

		const { router } = renderWithRouter(null, {
			routes: [homeRoute, aboutRoute],
			initialLocation: "/",
		});

		// Initial state
		expect(await screen.findByText("Home")).toBeInTheDocument();
		expect(router.state.location.pathname).toBe("/");

		// Click link
		await user.click(screen.getByTestId("about-link"));

		// Wait for navigation
		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/about");
		});

		expect(screen.getByText("About Page")).toBeInTheDocument();
	});

	it("should navigate programmatically", async () => {
		const user = userEvent.setup();

		function NavigationTest() {
			const navigate = (window as any).router?.navigate;

			const handleNavigate = () => {
				if (navigate) {
					navigate({ to: "/dashboard" });
				}
			};

			return (
				<div>
					<h1>Navigation Test</h1>
					<button
						onClick={handleNavigate}
						data-testid="navigate-btn"
						type="button"
					>
						Go to Dashboard
					</button>
				</div>
			);
		}

		const testRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: NavigationTest,
		});

		const dashboardRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/dashboard",
			component: () => <h1>Dashboard</h1>,
		});

		const { router } = renderWithRouter(null, {
			routes: [testRoute, dashboardRoute],
			initialLocation: "/",
		});

		// Store router globally for component access
		(window as any).router = router;

		expect(await screen.findByText("Navigation Test")).toBeInTheDocument();

		await user.click(screen.getByTestId("navigate-btn"));

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/dashboard");
		});

		expect(screen.getByText("Dashboard")).toBeInTheDocument();

		// Cleanup
		delete (window as any).router;
	});

	it("should handle browser back navigation", async () => {
		function Page1() {
			return (
				<div>
					<h1>Page 1</h1>
					<Link to={"/page2" as never} data-testid="page2-link">
						Go to Page 2
					</Link>
				</div>
			);
		}

		function Page2() {
			return <h1>Page 2</h1>;
		}

		const page1Route = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: Page1,
		});

		const page2Route = createRoute({
			getParentRoute: () => rootRoute,
			path: "/page2",
			component: Page2,
		});

		const { router } = renderWithRouter(null, {
			routes: [page1Route, page2Route],
			initialLocation: "/",
		});

		const user = userEvent.setup();

		// Wait for initial render and navigate to page 2
		await screen.findByText("Page 1");
		await user.click(screen.getByTestId("page2-link"));

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/page2");
		});

		expect(screen.getByText("Page 2")).toBeInTheDocument();

		// Navigate back
		router.history.back();

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/");
		});

		expect(screen.getByText("Page 1")).toBeInTheDocument();
	});

	it("should preserve query parameters during navigation", async () => {
		const user = userEvent.setup();

		function SearchPage() {
			return (
				<div>
					<h1>Search</h1>
					<Link
						to={"/results" as never}
						search={{ q: "test", filter: "recent" } as never}
						data-testid="results-link"
					>
						View Results
					</Link>
				</div>
			);
		}

		function ResultsPage() {
			return <h1>Results Page</h1>;
		}

		const searchRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/search",
			component: SearchPage,
		});

		const resultsRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/results",
			component: ResultsPage,
			validateSearch: (search) => ({
				q: (search.q as string) || "",
				filter: (search.filter as string) || "all",
			}),
		});

		const { router } = renderWithRouter(null, {
			routes: [searchRoute, resultsRoute],
			initialLocation: "/search",
		});

		// Wait for initial render
		await screen.findByText("Search");

		await user.click(screen.getByTestId("results-link"));

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/results");
		});

		expect(router.state.location.search).toEqual({
			q: "test",
			filter: "recent",
		});
	});
});
