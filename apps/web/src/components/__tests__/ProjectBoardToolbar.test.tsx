import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectBoardToolbar } from "@/components/project/ProjectBoardToolbar";
import type { ProjectField } from "@/server/projects";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	Link: ({
		to,
		params,
		search,
		children,
		className,
	}: {
		to: string;
		params?: Record<string, string>;
		search?: Record<string, unknown>;
		children: ReactNode;
		className?: string;
	}) => {
		const query = search
			? `?${new URLSearchParams(
					Object.entries(search).map(([key, value]) => [
						key,
						String(value ?? ""),
					]),
				).toString()}`
			: "";
		return (
			<a className={className} href={`${to}/${params?.number ?? ""}${query}`}>
				{children}
			</a>
		);
	},
}));

const fields: ProjectField[] = [
	{
		id: 1,
		name: "Status",
		dataType: "SINGLE_SELECT",
		options: [{ id: "9", name: "Todo", color: "GRAY" }],
	},
	{
		id: 2,
		name: "Team",
		dataType: "SINGLE_SELECT",
		options: [],
	},
	{ id: 3, name: "Points", dataType: "NUMBER", options: [] },
	{ id: 4, name: "Due", dataType: "DATE", options: [] },
];

function renderToolbar(
	search: Parameters<typeof ProjectBoardToolbar>[0]["search"],
) {
	return render(
		<ProjectBoardToolbar
			login="alice"
			number={3}
			view="board"
			search={search}
			fields={fields}
		/>,
	);
}

describe("ProjectBoardToolbar", () => {
	it("switches the view through the URL, keeping the other params", () => {
		renderToolbar({ q: "is:issue", sort: "updated", dir: "desc" });
		expect(screen.getByRole("link", { name: "Table" })).toHaveAttribute(
			"href",
			expect.stringContaining("q=is%3Aissue"),
		);
		expect(screen.getByRole("link", { name: "Table" })).toHaveAttribute(
			"href",
			expect.not.stringContaining("view=board"),
		);
		expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute(
			"href",
			expect.stringContaining("view=board"),
		);
	});

	it("navigates with group, sort and the card field in the URL", async () => {
		const user = userEvent.setup();
		renderToolbar({
			view: "board",
			sort: "title",
			dir: "asc",
			group: "Status",
		});
		await user.selectOptions(screen.getByLabelText("Group by"), "Team");
		expect(navigate.mock.calls.at(-1)?.[0].search).toMatchObject({
			group: "Team",
			view: "board",
		});

		await user.selectOptions(screen.getByLabelText("Sort by"), "points");
		expect(navigate.mock.calls.at(-1)?.[0].search).toMatchObject({
			sort: "points",
		});

		await user.selectOptions(screen.getByLabelText("Secondary field"), "due");
		expect(navigate.mock.calls.at(-1)?.[0].search).toMatchObject({ by: "due" });

		await user.click(screen.getByRole("button", { name: "Sort descending" }));
		expect(navigate.mock.calls.at(-1)?.[0].search).toMatchObject({
			dir: "desc",
		});
	});

	it("returns to the first page when the sort changes", async () => {
		const user = userEvent.setup();
		renderToolbar({ view: "board", sort: "title", page: 3 });
		await user.selectOptions(screen.getByLabelText("Sort by"), "updated");
		expect(navigate.mock.calls.at(-1)?.[0].search).not.toHaveProperty("page");
	});

	it("offers only single-select fields to group by and skips the group field on cards", () => {
		renderToolbar({ group: "Team" });
		expect(
			screen
				.getByRole("combobox", { name: "Group by" })
				.querySelectorAll("option"),
		).toHaveLength(2);
		const onCards = Array.from(
			screen
				.getByRole("combobox", { name: "Secondary field" })
				.querySelectorAll("option"),
		).map((option) => option.textContent);
		expect(onCards).not.toContain("Team");
	});
});
