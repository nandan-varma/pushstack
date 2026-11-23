import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
	{ id: 1, name: "Status", dataType: "SINGLE_SELECT", options: [] },
	{ id: 2, name: "Notes", dataType: "TEXT", options: [] },
	{ id: 3, name: "Team", dataType: "SINGLE_SELECT", options: [] },
];

const fieldsWithIds: ProjectField[] = [
	{
		id: 1,
		name: "Status",
		dataType: "SINGLE_SELECT",
		options: [
			{ id: "9", name: "Todo", color: "GRAY" },
			{ id: "10", name: "Done", color: "GREEN" },
		],
	},
	{ id: 2, name: "Notes", dataType: "TEXT", options: [] },
	{
		id: 3,
		name: "Team",
		dataType: "SINGLE_SELECT",
		options: [{ id: "11", name: "Core", color: "BLUE" }],
	},
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
		updatedAt: "2026-01-01T00:00:00.000Z",
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
		updatedAt: "2026-01-01T00:00:00.000Z",
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
		updatedAt: "2026-01-01T00:00:00.000Z",
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

	it("offers per-cell editors only to a writer", () => {
		const onSetValue = vi.fn();
		const writable = renderTable({
			fields,
			rows,
			emptyMessage: "Empty",
			canWrite: true,
			onSetValue,
			onClearValue: vi.fn(),
		});
		expect(
			screen.getByRole("combobox", { name: "Set Status for Visible work" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "Save" }).length).toBe(
			rows.length,
		);
		writable.unmount();

		renderTable({ fields, rows, emptyMessage: "Empty" });
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryAllByRole("button", { name: "Save" })).toEqual([]);
	});

	it("sends a select value by its option id and clears one", async () => {
		const user = userEvent.setup();
		const onSetValue = vi.fn();
		const onClearValue = vi.fn();
		renderTable({
			fields: fieldsWithIds,
			rows,
			emptyMessage: "Empty",
			canWrite: true,
			onSetValue,
			onClearValue,
		});
		await user.click(
			screen.getByRole("combobox", { name: "Set Team for Change it" }),
		);
		await user.click(await screen.findByRole("option", { name: "Core" }));
		expect(onSetValue).toHaveBeenCalledWith(2, fieldsWithIds[2], {
			type: "SINGLE_SELECT",
			optionId: "11",
		});

		await user.click(
			screen.getByRole("combobox", { name: "Set Status for Visible work" }),
		);
		await user.click(await screen.findByRole("option", { name: "None" }));
		expect(onClearValue).toHaveBeenCalledWith(1, fieldsWithIds[0]);
	});

	it("saves a text value and clears it", async () => {
		const user = userEvent.setup();
		const onSetValue = vi.fn();
		const onClearValue = vi.fn();
		renderTable({
			fields: fieldsWithIds,
			rows,
			emptyMessage: "Empty",
			canWrite: true,
			onSetValue,
			onClearValue,
		});
		const notes = screen.getByLabelText("Set Notes for Change it");
		await user.clear(notes);
		await user.type(notes, "hello");
		await user.click(screen.getAllByRole("button", { name: "Save" })[1]);
		expect(onSetValue).toHaveBeenCalledWith(2, fieldsWithIds[1], {
			type: "TEXT",
			text: "hello",
		});

		const withValue = screen.getByLabelText("Set Notes for Visible work");
		await user.clear(withValue);
		await user.type(withValue, "next");
		await user.click(screen.getByRole("button", { name: "Clear" }));
		expect(onClearValue).toHaveBeenCalledWith(1, fieldsWithIds[1]);
	});

	it("edits a draft through the pencil", async () => {
		const user = userEvent.setup();
		const onEditDraft = vi.fn();
		renderTable({
			fields,
			rows,
			emptyMessage: "Empty",
			canWrite: true,
			onEditDraft,
		});
		await user.click(
			screen.getByRole("button", { name: "Edit draft Draft plan" }),
		);
		expect(onEditDraft).toHaveBeenCalledWith(rows[2]);
	});
});

it("refreshes a cell editor after clearing or externally updating its value", () => {
	const props = {
		fields: fieldsWithIds,
		rows,
		emptyMessage: "Empty",
		canWrite: true,
		onSetValue: vi.fn(),
		onClearValue: vi.fn(),
	};
	const view = renderTable(props);
	expect(screen.getByLabelText("Set Notes for Visible work")).toHaveValue(
		"Needs review",
	);
	const cleared = rows.map((row) =>
		row.id === 1 ? { ...row, values: { ...row.values, notes: null } } : row,
	);
	view.rerender(
		<QueryClientProvider client={queryClient}>
			<ProjectTable {...props} rows={cleared} />
		</QueryClientProvider>,
	);
	expect(screen.getByLabelText("Set Notes for Visible work")).toHaveValue("");
	const refreshed = rows.map((row) =>
		row.id === 1
			? { ...row, values: { ...row.values, notes: "Updated elsewhere" } }
			: row,
	);
	view.rerender(
		<QueryClientProvider client={queryClient}>
			<ProjectTable {...props} rows={refreshed} />
		</QueryClientProvider>,
	);
	expect(screen.getByLabelText("Set Notes for Visible work")).toHaveValue(
		"Updated elsewhere",
	);
});
