import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectBoard } from "@/components/project/ProjectBoard";
import type { ProjectField, ProjectTableRow } from "@/server/projects";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		className,
	}: {
		to: string;
		params: Record<string, string>;
		children: ReactNode;
		className?: string;
	}) => (
		<a
			className={className}
			href={to
				.replace(/\/\{-\$\w+\}/g, "")
				.replace(/\$(\w+)/g, (_, key) => params[key])}
		>
			{children}
		</a>
	),
}));

const statusField: ProjectField = {
	id: 1,
	name: "Status",
	dataType: "SINGLE_SELECT",
	options: [
		{ id: "9", name: "Todo", color: "GRAY" },
		{ id: "10", name: "In Progress", color: "YELLOW" },
		{ id: "11", name: "Done", color: "GREEN" },
	],
};

const fields: ProjectField[] = [
	statusField,
	{ id: 2, name: "Points", dataType: "NUMBER", options: [] },
];

const rows: ProjectTableRow[] = [
	{
		id: 1,
		kind: "issue",
		title: "Ship the board",
		repoOwner: "alice",
		repoName: "shown",
		number: 7,
		body: null,
		updatedAt: "2026-02-01T00:00:00.000Z",
		values: { status: "Todo", points: "3" },
	},
	{
		id: 2,
		kind: "pull_request",
		title: "Change it",
		repoOwner: "alice",
		repoName: "shown",
		number: 8,
		body: null,
		updatedAt: "2026-02-02T00:00:00.000Z",
		values: { status: "Done", points: null },
	},
	{
		id: 3,
		kind: "draft",
		title: "Draft plan",
		repoOwner: null,
		repoName: null,
		number: null,
		body: null,
		updatedAt: "2026-02-03T00:00:00.000Z",
		values: { status: null, points: "5" },
	},
];

function renderBoard(
	overrides: Partial<Parameters<typeof ProjectBoard>[0]> = {},
) {
	return render(
		<ProjectBoard
			fields={fields}
			rows={rows}
			group="Status"
			by="points"
			canWrite
			pending={false}
			onSetValue={vi.fn()}
			onClearValue={vi.fn()}
			{...overrides}
		/>,
	);
}

describe("ProjectBoard", () => {
	it("groups by Status into the three option columns plus the empty one", () => {
		renderBoard();
		for (const name of [
			"Status: Todo",
			"Status: In Progress",
			"Status: Done",
			"Status: No Status",
		]) {
			expect(screen.getByRole("region", { name })).toBeInTheDocument();
		}
		expect(
			screen.getByRole("article", { name: "Ship the board in Todo" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("article", { name: "Draft plan in No Status" }),
		).toBeInTheDocument();
	});

	it("shows the secondary field value on each card", () => {
		renderBoard();
		expect(screen.getByText("Points: 3")).toBeInTheDocument();
		expect(screen.getByText("Points: —")).toBeInTheDocument();
	});

	it("drags a card into another column as one select-value mutation", () => {
		const onSetValue = vi.fn();
		const onClearValue = vi.fn();
		renderBoard({ onSetValue, onClearValue });
		fireEvent.dragStart(
			screen.getByRole("article", { name: "Ship the board in Todo" }),
		);
		fireEvent.drop(screen.getByRole("region", { name: "Status: In Progress" }));
		expect(onSetValue).toHaveBeenCalledTimes(1);
		expect(onSetValue).toHaveBeenCalledWith(1, statusField, {
			type: "SINGLE_SELECT",
			optionId: "10",
		});

		fireEvent.dragStart(
			screen.getByRole("article", { name: "Change it in Done" }),
		);
		fireEvent.drop(screen.getByRole("region", { name: "Status: No Status" }));
		expect(onClearValue).toHaveBeenCalledTimes(1);
		expect(onClearValue).toHaveBeenCalledWith(2, statusField);
	});

	it("does not drag for a read-only viewer", () => {
		renderBoard({ canWrite: false });
		expect(
			screen.getByRole("article", { name: "Ship the board in Todo" }),
		).not.toHaveAttribute("draggable", "true");
	});

	it("answers a group field that is not a single select", () => {
		renderBoard({ group: "Points" });
		expect(
			screen.getByText(/No single-select field named "Points"/),
		).toBeInTheDocument();
	});
});

it("board issue and pull request titles open the underlying content", () => {
	renderBoard();
	expect(screen.getByRole("link", { name: "Ship the board" })).toHaveAttribute(
		"href",
		"/alice/shown/issues/7",
	);
	expect(screen.getByRole("link", { name: "Change it" })).toHaveAttribute(
		"href",
		"/alice/shown/pull/8",
	);
});

it("read-only draft cards open details without edit controls", async () => {
	const user = userEvent.setup();
	renderBoard({ canWrite: false });
	await user.click(screen.getByRole("button", { name: "Draft plan" }));
	expect(
		await screen.findByRole("dialog", { name: "Draft plan" }),
	).toHaveTextContent("No description.");
	expect(screen.queryByRole("button", { name: /Edit draft/ })).toBeNull();
});
