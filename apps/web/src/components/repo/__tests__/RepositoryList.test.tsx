import { render, screen } from "@testing-library/react";
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
		children: React.ReactNode;
		[key: string]: unknown;
	}) => {
		const href = Object.entries(params)
			.reduce((url, [key, value]) => url.replace(`$${key}`, value), to)
			// TanStack's splat is empty for a repository root.
			.replace(/\/\$$/, "/");
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	},
}));

import { RepositoryRow } from "../RepositoryList";

const repo = {
	id: 1,
	name: "app",
	description: "A tiny app",
	visibility: "public",
	defaultBranch: "main",
	updatedAt: "2026-10-19T12:00:00.000Z",
	owner: { username: "alice" },
};

function renderRow(props: Partial<Parameters<typeof RepositoryRow>[0]> = {}) {
	return render(
		<ul>
			<RepositoryRow repo={repo} {...props} />
		</ul>,
	);
}

describe("RepositoryRow", () => {
	it("links owner / name to the default branch's tree", () => {
		renderRow();

		expect(screen.getByText("alice /")).toBeInTheDocument();
		expect(screen.getByText("app")).toBeInTheDocument();
		expect(screen.getByText(repo.description)).toBeInTheDocument();
		expect(screen.getByRole("link")).toHaveAttribute(
			"href",
			"/alice/app/tree/main/",
		);
	});

	it("drops the owner on a profile, keeping it in the link", () => {
		renderRow({ showOwner: false });

		expect(screen.queryByText("alice /")).not.toBeInTheDocument();
		expect(screen.getByRole("link")).toHaveAttribute(
			"href",
			"/alice/app/tree/main/",
		);
	});

	it("marks only private repositories", () => {
		renderRow();
		expect(screen.queryByLabelText("Private")).not.toBeInTheDocument();
	});

	it("labels a private repository", () => {
		renderRow({ repo: { ...repo, visibility: "private" } });
		expect(screen.getByLabelText("Private")).toBeInTheDocument();
	});

	it("leaves the description out of a compact row", () => {
		renderRow({ compact: true });
		expect(screen.queryByText(repo.description)).not.toBeInTheDocument();
	});
});
