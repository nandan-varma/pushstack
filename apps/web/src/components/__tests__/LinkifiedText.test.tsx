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
		// Unset optional segments (`{-$tab}`) drop out, as in the real router.
		const href = Object.entries(params)
			.reduce((url, [key, val]) => url.replace(`$${key}`, val), to)
			.replace(/\/\{-\$\w+\}/g, "");
		return (
			<a href={href} data-testid="router-link" {...props}>
				{children}
			</a>
		);
	},
}));

import { LinkifiedText } from "../LinkifiedText";

const owner = "acme";

function hrefOf(text: string): string | null {
	const link = screen.getByText(text).closest("[data-testid='router-link']");
	expect(link, `${text} should render as a link`).not.toBeNull();
	return link?.getAttribute("href") ?? null;
}
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
		expect(hrefOf("#1")).toBe("/acme/repo/issues/1");
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
		expect(hrefOf("#2")).toBe("/acme/repo/pull/2");
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
		expect(hrefOf("abc1234")).toBe("/acme/repo/commit/abc1234");
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
		expect(hrefOf("#1")).toBe("/acme/repo/issues/1");
		expect(hrefOf("abc1234")).toBe("/acme/repo/commit/abc1234");
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
		expect(container.querySelector(".custom-class")).not.toBeNull();
	});
});
