import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BuiltWithItself } from "../BuiltWithItself";
import { ShippingFeatures } from "../ShippingFeatures";

const paths = [
	"/$owner/$name",
	"/$owner/$name/forks",
	"/$owner/$name/pulls",
	"/$owner/$name/issues",
	"/$owner/$name/commits/$branch",
	"/$owner/$name/compare/$",
	"/$owner/$name/releases",
	"/notifications",
];

async function renderHome() {
	const root = createRootRoute();
	const routes = paths.map((path) =>
		createRoute({ getParentRoute: () => root, path, component: () => null }),
	);
	const home = createRoute({
		getParentRoute: () => root,
		path: "/",
		component: () => (
			<>
				<ShippingFeatures compareSpec="abc123...main" />
				<BuiltWithItself />
			</>
		),
	});
	const router = createRouter({
		routeTree: root.addChildren([...routes, home]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	render(<RouterProvider router={router} />);
}

test("every shipping feature links to the demo repository", async () => {
	await renderHome();

	expect(
		screen.getByRole("heading", {
			level: 2,
			name: "Room for the work around your code.",
		}),
	).toBeInTheDocument();
	expect(
		screen.getByRole("heading", {
			level: 3,
			name: "Make it your own. Bring it back.",
		}),
	).toBeInTheDocument();

	const links: [string, string][] = [
		["Explore the forks", "/nandan/pushstack/forks"],
		["Compare recent changes", "/nandan/pushstack/compare/abc123...main"],
		["Explore the issues", "/nandan/pushstack/issues"],
		["Review a pull request", "/nandan/pushstack/pulls"],
		["Browse the commits", "/nandan/pushstack/commits/main"],
		["Releases", "/nandan/pushstack/releases"],
		["Search the issues", "/nandan/pushstack/issues"],
		["Your inbox", "/notifications"],
	];
	for (const [name, href] of links) {
		expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
	}
});

test("the project links to its own issues and pull requests", async () => {
	await renderHome();

	expect(
		screen.getByRole("heading", {
			level: 2,
			name: "We’re building here, too.",
		}),
	).toBeInTheDocument();
	expect(
		screen.getByRole("link", { name: "nandan/pushstack" }),
	).toHaveAttribute("href", "/nandan/pushstack");
	expect(screen.getByRole("link", { name: "Issues" })).toHaveAttribute(
		"href",
		"/nandan/pushstack/issues",
	);
	expect(screen.getByRole("link", { name: "Pull requests" })).toHaveAttribute(
		"href",
		"/nandan/pushstack/pulls",
	);
});
