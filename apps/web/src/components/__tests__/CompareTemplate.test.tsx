import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
	template: "## Summary\n\nDescribe your changes.",
	templates: null as null | { filename: string; body: string }[],
	create: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({
		options,
		useParams: () => ({
			owner: "alice",
			name: "project",
			_splat: "main...feature",
		}),
	}),
	useNavigate: () => vi.fn(),
}));
vi.mock("@/lib/query-options", () => {
	const query = (key: string, value: unknown) => ({
		queryKey: [key],
		queryFn: async () => value,
	});
	return {
		authSessionQueryOptions: () => query("session", { user: { id: "alice" } }),
		repositoryByNameQueryOptions: () =>
			query("repository", { id: 1, defaultBranch: "main" }),
		repositoryBranchesQueryOptions: () =>
			query("branches", [{ name: "main" }, { name: "feature" }]),
		repositoryComparisonQueryOptions: () =>
			query("comparison", {
				aheadBy: 1,
				behindBy: 0,
				status: "ahead",
				commits: [{ message: "Fix bug" }],
				diff: { files: [] },
			}),
		repositoryTemplatesQueryOptions: () =>
			query("templates", {
				pullRequestTemplates: fixtures.templates ?? [
					{
						filename: ".github/pull_request_template.md",
						body: fixtures.template,
					},
				],
			}),
		queryKeys: {},
	};
});
vi.mock("@/server/pull-requests", () => ({
	createPullRequest: fixtures.create,
}));
vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/components/FileDiffViewer", () => ({
	FileDiffViewer: () => <div>Diff</div>,
}));
vi.mock("@/components/repo/CommitList", () => ({
	CommitList: () => <div>Commits</div>,
}));

import { Route } from "../../routes/$owner.$name.compare.$";

describe("compare pull request template", () => {
	beforeEach(() => {
		fixtures.create.mockReset();
		fixtures.templates = null;
	});

	it("offers a chooser for several templates and a choice replaces the description", async () => {
		fixtures.templates = [
			{ filename: ".github/pull_request_template/bug.md", body: "Bug body" },
			{
				filename: ".github/pull_request_template/feature.md",
				body: "Feature body",
			},
		];
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const Component = Route.options.component;
		if (!Component) throw new Error("Compare route has no component");
		render(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Create pull request" }),
		);
		expect(screen.getByLabelText("Description")).toHaveValue("Bug body");
		await userEvent.click(screen.getByLabelText("Template"));
		await userEvent.click(
			await screen.findByRole("option", { name: "feature.md" }),
		);
		expect(screen.getByLabelText("Description")).toHaveValue("Feature body");
	});

	it("shows no chooser when there is a single template", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const Component = Route.options.component;
		if (!Component) throw new Error("Compare route has no component");
		render(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Create pull request" }),
		);
		expect(screen.queryByLabelText("Template")).toBeNull();
	});

	it("prefills the description and preserves edits when reopening the dialog", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const Component = Route.options.component;
		if (!Component) throw new Error("Compare route has no component");
		render(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Create pull request" }),
		);
		expect(screen.getByLabelText("Description")).toHaveValue(fixtures.template);
		expect(screen.getByLabelText("Title")).toHaveValue("Fix bug");
		await userEvent.type(screen.getByLabelText("Description"), " Updated");
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Create pull request" }),
		);
		expect(screen.getByLabelText("Description")).toHaveValue(
			`${fixtures.template} Updated`,
		);
		await userEvent.clear(screen.getByLabelText("Description"));
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Create pull request" }),
		);
		expect(screen.getByLabelText("Description")).toHaveValue("");
	});
});
