import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		...props
	}: {
		to: string;
		params: Record<string, string>;
		children: ReactNode;
		[key: string]: unknown;
	}) => {
		let href = to;
		for (const [key, value] of Object.entries(params)) {
			href = href.replace(`$${key}`, value);
		}
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	},
}));

const { queryKeys } = await import("@/lib/query-options");
const { WikiPage } = await import("../WikiPage");

const REPO_ID = 7;

function wikiData(overrides: Record<string, unknown> = {}) {
	return {
		page: {
			name: "Home",
			content: "# Home\n\nStart with [[Second Page]].\n",
			size: 40,
			tooLarge: false,
		},
		sidebar: "**Sidebar text**",
		footer: "_Footer text_",
		pages: ["Home", "Second-Page"],
		canEdit: true,
		...overrides,
	};
}

function renderWiki(page?: string, data = wikiData()) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(queryKeys.repositoryByName("alice", "pub"), {
		id: REPO_ID,
		hasWiki: true,
	});
	queryClient.setQueryData(queryKeys.repoIssueNumbers(REPO_ID), []);
	queryClient.setQueryData(queryKeys.repoPullRequestNumbers(REPO_ID), []);
	queryClient.setQueryData(
		page ? queryKeys.repoWikiPage(REPO_ID, page) : queryKeys.repoWiki(REPO_ID),
		data,
	);
	return render(
		<QueryClientProvider client={queryClient}>
			<WikiPage owner="alice" name="pub" page={page} />
		</QueryClientProvider>,
	);
}

describe("WikiPage", () => {
	it("renders Home, the sidebar, the footer and a [[wiki link]]", async () => {
		renderWiki();
		expect(
			await screen.findByRole("heading", { name: "Home" }),
		).toBeInTheDocument();
		expect(await screen.findByText("Sidebar text")).toBeInTheDocument();
		expect(screen.getByText("Footer text")).toBeInTheDocument();
		expect(
			within(screen.getByRole("article")).getByRole("link", {
				name: "Second Page",
			}),
		).toHaveAttribute("href", "/alice/pub/wiki/Second-Page");
	});

	it("renders the create-page state for a page that does not exist", async () => {
		renderWiki(
			"Missing",
			wikiData({ page: null, sidebar: null, footer: null }),
		);
		expect(
			await screen.findByText("This page does not exist yet"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Create this page" }),
		).toHaveAttribute("href", "/alice/pub/wiki/_new");
	});

	it("renders no javascript: href from page content", async () => {
		renderWiki(
			undefined,
			wikiData({
				page: {
					name: "Home",
					content: "[click me](javascript:alert(1))",
					size: 40,
					tooLarge: false,
				},
				sidebar: null,
				footer: null,
			}),
		);
		expect(await screen.findByText("click me")).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "click me" }),
		).not.toBeInTheDocument();
		expect(
			document.querySelector('a[href^="javascript:"]'),
		).not.toBeInTheDocument();
	});

	it("renders the clone-it notice for a page over the render cap", async () => {
		renderWiki(
			"Too-Big",
			wikiData({
				page: {
					name: "Too-Big",
					content: null,
					size: 600_000,
					tooLarge: true,
				},
				sidebar: null,
				footer: null,
			}),
		);
		expect(
			await screen.findByText(
				"This page is too large to display. Clone the wiki to read it.",
			),
		).toBeInTheDocument();
	});
});
