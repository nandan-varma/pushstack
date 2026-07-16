/**
 * Tests for LinkifiedText component — renders #N and SHA references as links.
 */
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
		const href = Object.entries(params).reduce(
			(url, [key, val]) => url.replace(`$${key}`, val),
			to,
		);
		return (
			<a href={href} data-testid="router-link" {...props}>
				{children}
			</a>
		);
	},
}));

import { LinkifiedText } from "../LinkifiedText";

const owner = "acme";
const name = "repo";

describe("LinkifiedText", () => {
	const resolveReference = (num: number) => {
		if (num === 1) return "issue" as const;
		if (num === 2) return "pull" as const;
		return null;
	};

	it("renders plain text without references as-is", () => {
		render(
			<LinkifiedText text="no references here" owner={owner} name={name} />,
		);
		expect(screen.getByText("no references here")).toBeDefined();
	});

	it("links #N as issue when resolveReference returns 'issue'", () => {
		render(
			<LinkifiedText
				text="fixes #1"
				owner={owner}
				name={name}
				resolveReference={resolveReference}
			/>,
		);
		const link = screen.getByText("#1");
		expect(link.closest("[data-testid='router-link']")).toBeDefined();
	});

	it("links #N as pull request when resolveReference returns 'pull'", () => {
		render(
			<LinkifiedText
				text="see #2"
				owner={owner}
				name={name}
				resolveReference={resolveReference}
			/>,
		);
		const link = screen.getByText("#2");
		expect(link.closest("[data-testid='router-link']")).toBeDefined();
	});

	it("leaves unrecognized #N as plain text", () => {
		render(
			<LinkifiedText
				text="fixes #999"
				owner={owner}
				name={name}
				resolveReference={resolveReference}
			/>,
		);
		const text = screen.getByText("fixes #999");
		expect(text.closest("[data-testid='router-link']")).toBeNull();
	});

	it("links commit SHAs", () => {
		render(<LinkifiedText text="revert abc1234" owner={owner} name={name} />);
		const link = screen.getByText("abc1234");
		expect(link.closest("[data-testid='router-link']")).toBeDefined();
	});

	it("handles multiple references", () => {
		render(
			<LinkifiedText
				text="fixes #1 and reverts abc1234"
				owner={owner}
				name={name}
				resolveReference={resolveReference}
			/>,
		);
		expect(
			screen.getByText("#1").closest("[data-testid='router-link']"),
		).toBeDefined();
		expect(
			screen.getByText("abc1234").closest("[data-testid='router-link']"),
		).toBeDefined();
	});

	it("applies custom className", () => {
		const { container } = render(
			<LinkifiedText
				text="hello"
				owner={owner}
				name={name}
				className="custom-class"
			/>,
		);
		expect(container.querySelector(".custom-class")).toBeDefined();
	});
});
