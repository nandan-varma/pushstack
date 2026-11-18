import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectTable } from "@/components/project/ProjectTable";
import type { ProjectField, ProjectTableRow } from "@/server/projects";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		className,
	}: {
		to: string;
		params?: Record<string, string>;
		children: ReactNode;
		className?: string;
	}) => (
		<a
			className={className}
			href={to
				.replace(/\/\{-\$\w+\}/g, "")
				.replace(/\$(\w+)/g, (_, key) => params?.[key] ?? "")}
		>
			{children}
		</a>
	),
}));

const fields: ProjectField[] = [
	{ name: "Status", dataType: "SINGLE_SELECT", options: [] },
	{ name: "Notes", dataType: "TEXT", options: [] },
	{ name: "Team", dataType: "SINGLE_SELECT", options: [] },
];

const rows: ProjectTableRow[] = [
	{
		id: 1,
		kind: "issue",
		title: "Visible work",
		repoOwner: "alice",
		repoName: "shown",
		number: 7,
		body: null,
		values: { status: "Todo", notes: "Needs review", team: null },
	},
	{
		id: 2,
		kind: "pull_request",
		title: "Change it",
		repoOwner: "alice",
		repoName: "shown",
		number: 8,
		body: null,
		values: { status: "Done", notes: null, team: "Core" },
	},
	{
		id: 3,
		kind: "draft",
		title: "Draft plan",
		repoOwner: null,
		repoName: null,
		number: null,
		body: "**Soon**",
		values: { status: null, notes: null, team: null },
	},
];

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

function renderTable(props: Parameters<typeof ProjectTable>[0]) {
	return render(
		<QueryClientProvider client={queryClient}>
			<ProjectTable {...props} />
		</QueryClientProvider>,
	);
}

describe("ProjectTable", () => {
	it("shows the built-in Status and each custom field", () => {
		renderTable({ fields, rows, emptyMessage: "Empty" });
		for (const name of ["Title", "Status", "Notes", "Team"]) {
			expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
		}
		expect(screen.getByText("Todo")).toBeInTheDocument();
		expect(screen.getByText("Needs review")).toBeInTheDocument();
		expect(screen.getByText("Core")).toBeInTheDocument();
	});

	it("links issues and pull requests to their repository", () => {
		renderTable({ fields, rows, emptyMessage: "Empty" });
		expect(screen.getByRole("link", { name: "Visible work" })).toHaveAttribute(
			"href",
			"/alice/shown/issues/7",
		);
		expect(screen.getByRole("link", { name: "Change it" })).toHaveAttribute(
			"href",
			"/alice/shown/pull/8",
		);
	});

	it("renders a draft's body as markdown, not text", async () => {
		renderTable({ fields, rows, emptyMessage: "Empty" });
		expect(screen.getByText("Draft plan")).toBeInTheDocument();
		expect(
			await screen.findByText("Soon", undefined, { timeout: 10_000 }),
		).toBeInTheDocument();
	});

	it("shows the empty message with no rows", () => {
		renderTable({ fields, rows: [], emptyMessage: "Empty" });
		expect(screen.getByText("Empty")).toBeInTheDocument();
		expect(screen.queryByRole("table")).toBeNull();
	});
});
