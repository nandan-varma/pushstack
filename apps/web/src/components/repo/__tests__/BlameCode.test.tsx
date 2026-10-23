import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BlameCode from "../BlameCode";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params: _params,
		children,
		...props
	}: {
		to: string;
		params: Record<string, string>;
		children: React.ReactNode;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));
vi.mock("@/hooks/use-highlighted-code", () => ({
	useHighlightedCode: () => ({
		status: "done",
		html: '<pre class="shiki"><code></code></pre>',
	}),
}));

const sha = (c: string) => c.repeat(40);
const commit = (c: string, authorName: string, message: string) => ({
	sha: sha(c),
	message,
	authorName,
	authorEmail: "x@y.z",
	createdAt: "2026-01-01T00:00:00.000Z",
	parentSha: sha("0"),
});

describe("BlameCode", () => {
	it("shows author and age for single-line and multi-line ranges alike", () => {
		render(
			<BlameCode
				owner="alice"
				name="app"
				filePath="a.ts"
				language="typescript"
				blame={{
					kind: "blame",
					headSha: sha("a"),
					lines: ["one", "two", "three"],
					truncated: false,
					ranges: [
						{ startLine: 1, endLine: 1, sha: sha("a") },
						{ startLine: 2, endLine: 3, sha: sha("b") },
					],
					commits: {
						[sha("a")]: commit("a", "Ada", "single"),
						[sha("b")]: commit("b", "Grace", "double"),
					},
				}}
			/>,
		);
		expect(screen.getByText("single")).toBeInTheDocument();
		expect(screen.getByText("Ada")).toBeInTheDocument();
		expect(screen.getByText("Grace")).toBeInTheDocument();
		expect(
			screen.getAllByRole("link", { name: /View blame before/ }),
		).toHaveLength(2);
	});
});
