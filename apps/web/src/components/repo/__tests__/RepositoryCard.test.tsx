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

import { RepositoryCard } from "../RepositoryCard";

const repo = {
	id: 1,
	name: "app",
	description: "A tiny app",
	visibility: "public",
	defaultBranch: "main",
	updatedAt: "2026-10-19T12:00:00.000Z",
	owner: { username: "alice" },
};

describe("RepositoryCard", () => {
	it("titles a list card owner/name with the badge, clamp and updated date", () => {
		render(<RepositoryCard repo={repo} />);

		const title = screen.getByRole("heading", { level: 3, name: "alice/app" });
		expect(title).toHaveAttribute("title", "alice/app");
		expect(screen.getByText("public")).toBeInTheDocument();
		expect(screen.getByText(repo.description)).toHaveClass("line-clamp-2");
		expect(
			screen.getByText(new Date(repo.updatedAt).toLocaleDateString()),
		).toBeInTheDocument();
		expect(screen.getByRole("link")).toHaveAttribute(
			"href",
			"/alice/app/tree/main/",
		);
	});

	it("omits an empty description instead of printing a placeholder", () => {
		const { container } = render(
			<RepositoryCard repo={{ ...repo, description: null }} />,
		);

		expect(screen.queryByText("No description")).not.toBeInTheDocument();
		expect(container.querySelector("p")).toBeNull();
	});

	it("titles a profile card with the repository name only, keeping the owner in the link", () => {
		render(<RepositoryCard repo={repo} showOwner={false} />);

		expect(
			screen.getByRole("heading", { level: 3, name: "app" }),
		).toBeInTheDocument();
		expect(screen.queryByText("alice/app")).not.toBeInTheDocument();
		expect(screen.getByRole("link")).toHaveAttribute(
			"href",
			"/alice/app/tree/main/",
		);
	});

	it("badges a private repository", () => {
		render(<RepositoryCard repo={{ ...repo, visibility: "private" }} />);

		expect(screen.getByText("private")).toBeInTheDocument();
	});
});
