import { useSuspenseQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({ useSuspenseQuery: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({
		options,
		useParams: () => ({ owner: "alice", name: "project" }),
	}),
	Link: () => null,
}));
vi.mock("@/lib/query-options", () => ({
	repositoryByNameQueryOptions: vi.fn(),
	repositoryTemplatesQueryOptions: vi.fn(),
}));

import { Route } from "../../routes/$owner.$name.issues_.new_.choose";

describe("template chooser contact links", () => {
	it("renders safe URLs and omits unsafe hrefs", () => {
		vi.mocked(useSuspenseQuery)
			.mockReturnValueOnce({
				data: { id: 1, viewer: { canWrite: false } },
			} as ReturnType<typeof useSuspenseQuery>)
			.mockReturnValueOnce({
				data: {
					issueTemplates: [],
					blankIssuesEnabled: false,
					contactLinks: [
						{ name: "Help", about: "Ask", url: "https://example.com/help" },
						{ name: "Unsafe", about: "Blocked", url: "javascript:alert(1)" },
					],
				},
			} as ReturnType<typeof useSuspenseQuery>);
		const Component = Route.options.component;
		if (!Component) throw new Error("Missing chooser component");
		render(<Component />);
		const links = screen.getAllByText("Open");
		expect(links[0]).toHaveAttribute("href", "https://example.com/help");
		expect(links[1]).not.toHaveAttribute("href");
	});
});
