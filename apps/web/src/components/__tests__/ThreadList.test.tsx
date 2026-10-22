import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NewThreadDialog } from "@/components/thread-list/NewThreadDialog";
import { ThreadFilters } from "@/components/thread-list/ThreadFilters";
import { ThreadList, ThreadRow } from "@/components/thread-list/ThreadList";

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
			href={to.replace(/\$(\w+)/g, (_, k) => params?.[k] ?? "")}
		>
			{children}
		</a>
	),
}));
vi.mock("@/components/LabelFilter", () => ({
	LabelFilter: () => null,
}));

const thread = {
	id: 1,
	number: 7,
	title: "Broken thing",
	status: "open",
	createdAt: "2024-01-02T00:00:00Z",
	author: { name: "alice" },
	labels: [{ id: 1, name: "bug", color: "ff0000" }],
};

describe("ThreadList", () => {
	it("shows skeletons while loading", () => {
		const { container } = render(
			<ThreadList
				threads={undefined}
				isLoading
				emptyMessage="m"
				emptyAction={null}
			>
				{() => null}
			</ThreadList>,
		);
		expect(container.querySelectorAll("[aria-busy=\"true\"] li")).toHaveLength(3);
	});

	it("shows the empty message and action with no rows", () => {
		render(
			<ThreadList
				threads={[]}
				isLoading={false}
				emptyMessage="No open issues found."
				emptyAction={<button type="button">Create first issue</button>}
			>
				{() => null}
			</ThreadList>,
		);
		expect(screen.getByText("No open issues found.")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Create first issue" }),
		).toBeInTheDocument();
	});

	it("renders rows linking to the detail route", () => {
		render(
			<ThreadList
				threads={[thread]}
				isLoading={false}
				emptyMessage="m"
				emptyAction={null}
			>
				{(t) => (
					<ThreadRow kind="pull" owner="o" name="n" thread={t}>
						<span>extra</span>
					</ThreadRow>
				)}
			</ThreadList>,
		);
		const link = screen.getByRole("link");
		expect(link).toHaveAttribute("href", "/o/n/pulls/7");
		expect(link).toHaveTextContent("Broken thing");
		expect(link).toHaveTextContent(/#7.*opened/);
		expect(link).toHaveTextContent("by alice");
		expect(link).toHaveTextContent("extra");
		expect(link).toHaveTextContent("bug");
	});

	it("links issue rows to the issue route", () => {
		render(<ThreadRow kind="issue" owner="o" name="n" thread={thread} />);
		expect(screen.getByRole("link")).toHaveAttribute("href", "/o/n/issues/7");
	});
});

describe("ThreadFilters", () => {
	const tabs = [
		{ value: "open" as const, label: "Open" },
		{ value: "closed" as const, label: "Closed" },
	];

	it("counts only the active tab and falls back to open", () => {
		render(
			<ThreadFilters
				q="is:merged"
				repoId={1}
				tabs={tabs}
				loadedCount={4}
				onQueryChange={() => {}}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Open (4)" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Closed" })).toBeInTheDocument();
	});

	it("rewrites the query when a tab is clicked", async () => {
		const onQueryChange = vi.fn();
		render(
			<ThreadFilters
				q="label:bug"
				repoId={1}
				tabs={tabs}
				loadedCount={0}
				onQueryChange={onQueryChange}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Closed" }));
		expect(onQueryChange).toHaveBeenCalledWith(
			expect.stringContaining("is:closed"),
		);
		expect(onQueryChange.mock.calls[0][0]).toContain("label:bug");
	});
});

describe("NewThreadDialog", () => {
	it("submits and disables while pending", async () => {
		const onSubmit = vi.fn();
		const { rerender } = render(
			<NewThreadDialog
				open
				onOpenChange={() => {}}
				triggerLabel="New issue"
				title="Create new issue"
				description="d"
				submitLabel="Create issue"
				canSubmit
				isPending={false}
				onSubmit={onSubmit}
			>
				<p>fields</p>
			</NewThreadDialog>,
		);
		expect(screen.getByText("fields")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Create issue" }));
		expect(onSubmit).toHaveBeenCalledTimes(1);

		rerender(
			<NewThreadDialog
				open
				onOpenChange={() => {}}
				triggerLabel="New issue"
				title="Create new issue"
				description="d"
				submitLabel="Create issue"
				canSubmit
				isPending
				onSubmit={onSubmit}
			>
				<p>fields</p>
			</NewThreadDialog>,
		);
		expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
	});
});
