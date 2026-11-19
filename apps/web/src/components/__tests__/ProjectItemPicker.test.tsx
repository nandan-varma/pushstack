import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectItemPicker } from "@/components/project/ProjectItemPicker";

const onSearch = vi.fn();
const onAdd = vi.fn();

const results = [
	{
		id: 7,
		title: "Visible work",
		number: 1,
		kind: "issue" as const,
		repoOwner: "alice",
		repoName: "shown",
	},
	{
		id: 8,
		title: "Change it",
		number: 2,
		kind: "pull_request" as const,
		repoOwner: "alice",
		repoName: "shown",
	},
];

function renderPicker(
	props: Partial<Parameters<typeof ProjectItemPicker>[0]> = {},
) {
	return render(
		<ProjectItemPicker
			login="alice"
			number={3}
			itemCount={2}
			pending={false}
			results={results}
			onSearch={onSearch}
			onAdd={onAdd}
			{...props}
		/>,
	);
}

describe("ProjectItemPicker", () => {
	it("lists the readable issues and pull requests", async () => {
		const user = userEvent.setup();
		renderPicker();
		await user.click(screen.getByRole("button", { name: "Add item" }));
		expect(screen.getByText("Visible work")).toBeInTheDocument();
		expect(screen.getByText("alice/shown#1")).toBeInTheDocument();
		expect(screen.getByText("Pull request")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /Change it/ }));
		expect(onAdd).toHaveBeenCalledWith(8);
	});

	it("forwards the search box to the query", async () => {
		const user = userEvent.setup();
		renderPicker();
		await user.click(screen.getByRole("button", { name: "Add item" }));
		await user.type(
			screen.getByLabelText("Search issues and pull requests"),
			"vis",
		);
		expect(onSearch).toHaveBeenLastCalledWith("vis");
	});

	it("asks to type when there are no results", async () => {
		const user = userEvent.setup();
		renderPicker({ results: [] });
		await user.click(screen.getByRole("button", { name: "Add item" }));
		expect(
			screen.getByText("Type to search issues and pull requests you can read."),
		).toBeInTheDocument();
	});
});
