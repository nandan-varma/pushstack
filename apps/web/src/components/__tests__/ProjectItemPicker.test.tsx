import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectItemPicker } from "@/components/project/ProjectItemPicker";

const searchItems = vi.hoisted(() => vi.fn());
vi.mock("@/lib/query-options", () => ({
	projectAddableItemsQueryOptions: (
		login: string,
		number: number,
		query: string,
	) => ({
		queryKey: ["project-items", login, number, query],
		queryFn: () => searchItems(query),
	}),
}));
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
	searchItems.mockResolvedValue({ items: results });
	return render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<ProjectItemPicker
				login="alice"
				number={3}
				itemCount={2}
				pending={false}
				onAdd={onAdd}
				{...props}
			/>
		</QueryClientProvider>,
	);
}

describe("ProjectItemPicker", () => {
	it("lists the readable issues and pull requests", async () => {
		const user = userEvent.setup();
		renderPicker();
		await user.click(screen.getByRole("button", { name: "Add item" }));
		expect(await screen.findByText("Visible work")).toBeInTheDocument();
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
		await waitFor(() => expect(searchItems).toHaveBeenLastCalledWith("vis"));
	});

	it("asks to type when there are no results", async () => {
		const user = userEvent.setup();
		renderPicker();
		searchItems.mockResolvedValue({ items: [] });
		await user.click(screen.getByRole("button", { name: "Add item" }));
		expect(
			await screen.findByText(
				"Type to search issues and pull requests you can read.",
			),
		).toBeInTheDocument();
	});
});

it("only searches after the owner opens the picker", async () => {
	const user = userEvent.setup();
	renderPicker();
	expect(searchItems).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Add item" }));
	await waitFor(() => expect(searchItems).toHaveBeenCalledWith(""));
});

it("distinguishes a failed search from no matches and can retry", async () => {
	const user = userEvent.setup();
	renderPicker();
	searchItems.mockRejectedValueOnce(new Error("offline"));
	await user.click(screen.getByRole("button", { name: "Add item" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t search");
	expect(
		screen.queryByText("Type to search issues and pull requests you can read."),
	).toBeNull();
	await user.click(screen.getByRole("button", { name: "Try again" }));
	expect(await screen.findByText("Visible work")).toBeInTheDocument();
});

it("shows loading instead of no matches while a search is pending", async () => {
	const user = userEvent.setup();
	renderPicker();
	searchItems.mockImplementationOnce(() => new Promise(() => {}));
	await user.click(screen.getByRole("button", { name: "Add item" }));
	expect(await screen.findByRole("status")).toHaveTextContent("Searching");
	expect(
		screen.queryByText("Type to search issues and pull requests you can read."),
	).toBeNull();
});
