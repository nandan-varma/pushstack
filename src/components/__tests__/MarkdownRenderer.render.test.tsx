/**
 * Render-level tests for MarkdownRenderer's link/image handling. The pure
 * isSafeHref/isSafeImageSrc guards are covered in MarkdownRenderer.test.ts —
 * these tests confirm buildComponents' `a`/`img` renderers actually apply
 * those guards at render time (so a future refactor that forgets to call
 * them, or reorders the checks, breaks a test instead of shipping an XSS).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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
		children: ReactNode;
		[key: string]: unknown;
	}) => {
		// TanStack's splat param has no literal `$_splat` placeholder in the
		// route string — it's the bare trailing `$` — so that one substitutes
		// positionally instead of by name, matching the real router's shape.
		let href = to;
		for (const [key, val] of Object.entries(params)) {
			href =
				key === "_splat"
					? href.replace(/\$$/, val)
					: href.replace(`$${key}`, val);
		}
		return (
			<a href={href} data-testid="router-link" {...props}>
				{children}
			</a>
		);
	},
}));

import MarkdownRenderer from "../MarkdownRenderer";

function renderMarkdown(
	props: Omit<Parameters<typeof MarkdownRenderer>[0], never>,
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<MarkdownRenderer {...props} />
		</QueryClientProvider>,
	);
}

describe("MarkdownRenderer link safety", () => {
	it("renders a safe external link as a real anchor with noopener", () => {
		// External-link target/rel handling only applies once buildComponents
		// installs its custom `a` renderer, which requires owner+name.
		renderMarkdown({
			content: "[go](https://example.com)",
			owner: "acme",
			name: "widgets",
		});
		const link = screen.getByRole("link", { name: "go" });
		expect(link).toHaveAttribute("href", "https://example.com");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noopener noreferrer");
	});

	it("does not render a javascript: link as a clickable anchor", () => {
		renderMarkdown({
			content: "[click me](javascript:alert(1))",
			owner: "acme",
			name: "widgets",
		});
		expect(screen.queryByRole("link", { name: "click me" })).toBeNull();
		expect(screen.getByText("click me")).toBeInTheDocument();
	});

	it("does not render a data:text/html link as a clickable anchor", () => {
		renderMarkdown({
			content: "[click me](data:text/html,<script>alert(1)</script>)",
			owner: "acme",
			name: "widgets",
		});
		expect(screen.queryByRole("link", { name: "click me" })).toBeNull();
	});

	it("renders a relative link as plain text when no owner/name context is given", () => {
		// Without owner+name, buildComponents falls back to the minimal-safe
		// anchor (safeAnchor) instead of the Link-aware one — still goes
		// through isSafeHref, just renders a plain relative <a> rather than a
		// router Link.
		renderMarkdown({ content: "[docs](./docs/readme.md)" });
		const link = screen.getByRole("link", { name: "docs" });
		expect(link).toHaveAttribute("href", "./docs/readme.md");
	});

	it("still blocks a javascript: link via the fallback safeAnchor when no owner/name is given", () => {
		renderMarkdown({ content: "[click me](javascript:alert(1))" });
		expect(screen.queryByRole("link", { name: "click me" })).toBeNull();
		expect(screen.getByText("click me")).toBeInTheDocument();
	});

	it("renders a relative repo file link as a router Link when branch context is given", () => {
		renderMarkdown({
			content: "[docs](./docs/readme.md)",
			owner: "acme",
			name: "widgets",
			branch: "main",
		});
		const link = screen.getByTestId("router-link");
		expect(link).toHaveAttribute(
			"href",
			"/repo/acme/widgets/blob/main/docs/readme.md",
		);
	});

	it("rewrites a cross-entity reference link (#N style) to the router Link for that resource", () => {
		renderMarkdown({
			content: "[see PR](/repo/acme/widgets/pulls/42)",
			owner: "acme",
			name: "widgets",
		});
		const link = screen.getByTestId("router-link");
		expect(link).toHaveAttribute("href", "/repo/acme/widgets/pulls/42");
	});

	it("does not render a relative link as an unsafe raw anchor even without branch context", () => {
		renderMarkdown({
			content: "[click me](javascript:alert(1))",
			owner: "acme",
			name: "widgets",
		});
		expect(screen.queryByRole("link", { name: "click me" })).toBeNull();
	});
});

describe("MarkdownRenderer image safety", () => {
	// The isSafeImageSrc guard lives in buildComponents' custom `img` renderer,
	// which (like `a`) is only installed once owner+name are given; without
	// them the fallback safeImg applies the same guard. Owner+name is passed
	// here so the branch-aware, file-relative src rewriting is exercised too.
	it("renders a safe inline base64 image", () => {
		renderMarkdown({
			content: "![alt](data:image/png;base64,AAAA)",
			owner: "acme",
			name: "widgets",
		});
		const img = screen.getByAltText("alt");
		expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
	});

	it("does not render an image with a data:text/html src", () => {
		renderMarkdown({
			content: "![alt](data:text/html,<script>alert(1)</script>)",
			owner: "acme",
			name: "widgets",
		});
		expect(screen.queryByAltText("alt")).toBeNull();
	});

	it("does not render an image with a javascript: src", () => {
		renderMarkdown({
			content: "![alt](javascript:alert(1))",
			owner: "acme",
			name: "widgets",
		});
		expect(screen.queryByAltText("alt")).toBeNull();
	});

	it("still allows a safe base64 image via the fallback safeImg when no owner/name is given", () => {
		renderMarkdown({ content: "![alt](data:image/png;base64,AAAA)" });
		const img = screen.getByAltText("alt");
		expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
	});

	it("rewrites a relative image src to the raw-content route when branch context is given", () => {
		renderMarkdown({
			content: "![diagram](./assets/diagram.png)",
			owner: "acme",
			name: "widgets",
			branch: "main",
			filePath: "README.md",
		});
		const img = screen.getByAltText("diagram");
		expect(img).toHaveAttribute(
			"src",
			"/api/raw/acme/widgets/main/assets/diagram.png",
		);
	});

	it("resolves a relative image src against the file that contains it", () => {
		renderMarkdown({
			content: "![diagram](./diagram.png)",
			owner: "acme",
			name: "widgets",
			branch: "main",
			filePath: "docs/guides/README.md",
		});
		expect(screen.getByAltText("diagram")).toHaveAttribute(
			"src",
			"/api/raw/acme/widgets/main/docs/guides/diagram.png",
		);
	});

	it("does not invent a src for a relative image that escapes the repository root", () => {
		renderMarkdown({
			content: "![diagram](../../../../etc/passwd)",
			owner: "acme",
			name: "widgets",
			branch: "main",
			filePath: "docs/README.md",
		});
		expect(screen.queryByAltText("diagram")).toBeNull();
	});

	it("resolves a relative link target against the containing file too", () => {
		renderMarkdown({
			content: "[sibling](../other/y.md)",
			owner: "acme",
			name: "widgets",
			branch: "main",
			filePath: "docs/guides/x.md",
		});
		expect(screen.getByTestId("router-link")).toHaveAttribute(
			"href",
			"/repo/acme/widgets/blob/main/docs/other/y.md",
		);
	});

	it("never emits an href or src the browser resolves to javascript:", () => {
		// `java\tscript:` and `\u0001javascript:` are both live javascript: URLs
		// to a browser: the URL parser strips the tab / leading control before
		// it looks for a scheme. The markdown parser percent-encodes the control
		// character, which is what keeps these inert today — so assert the
		// outcome through the browser's own URL algorithm rather than trusting
		// that encoding to keep happening.
		for (const payload of [
			"[click me](<java\tscript:alert(1)>)",
			"[click me](<\u0001javascript:alert(1)>)",
			"[click me](<java\u0000script:alert(1)>)",
			"![alt](<java\tscript:alert(1)>)",
		]) {
			const { container, unmount } = renderMarkdown({
				content: payload,
				owner: "acme",
				name: "widgets",
			});
			for (const element of container.querySelectorAll("a[href], img[src]")) {
				const value =
					element.getAttribute("href") ?? element.getAttribute("src") ?? "";
				expect(new URL(value, "https://example.test/").protocol).not.toBe(
					"javascript:",
				);
				expect(
					[...value].some(
						(character) =>
							character.charCodeAt(0) <= 0x20 ||
							character.charCodeAt(0) === 0x7f,
					),
				).toBe(false);
			}
			unmount();
		}
	});
});

describe("MarkdownRenderer basic rendering", () => {
	it("renders plain markdown content", () => {
		renderMarkdown({ content: "# Hello\n\nWorld" });
		expect(screen.getByText("Hello")).toBeInTheDocument();
		expect(screen.getByText("World")).toBeInTheDocument();
	});

	it("applies the given className to the wrapper", () => {
		const { container } = renderMarkdown({
			content: "hi",
			className: "custom-md",
		});
		expect(container.querySelector(".custom-md")).toBeInTheDocument();
	});
});
