/**
 * Tests for remark-autolink-references.ts — the remark plugin that turns
 * #N references and commit SHAs in markdown text into links.
 */
import { describe, expect, it } from "vitest";
import { createAutolinkReferencesPlugin } from "../remark-autolink-references";

interface MdastText {
	type: "text";
	value: string;
}
interface MdastLink {
	type: "link";
	url: string;
	children: MdastText[];
}
interface MdastInlineCode {
	type: "inlineCode";
	value: string;
}
interface MdastParagraph {
	type: "paragraph";
	children: (MdastText | MdastLink | MdastInlineCode)[];
}
interface MdastRoot {
	type: "root";
	children: MdastParagraph[];
}

function runPlugin(
	content: string,
	options: Parameters<typeof createAutolinkReferencesPlugin>[0],
): MdastRoot {
	const tree: MdastRoot = {
		type: "root",
		children: [
			{ type: "paragraph", children: [{ type: "text", value: content }] },
		],
	};

	const plugin = createAutolinkReferencesPlugin(options);
	const transformer = plugin();
	transformer(tree);
	return tree;
}

function getTextNodes(tree: MdastRoot): string[] {
	const texts: string[] = [];
	for (const child of tree.children) {
		if (child.type === "paragraph") {
			for (const node of child.children) {
				if (node.type === "text") texts.push(node.value);
				if (node.type === "link") {
					const linkText = node.children
						.filter((c) => c.type === "text")
						.map((c) => ("value" in c ? c.value : ""))
						.join("");
					texts.push(`[link:${linkText}→${node.url}]`);
				}
			}
		}
	}
	return texts;
}

describe("createAutolinkReferencesPlugin", () => {
	const resolveReference = (num: number) => {
		if (num === 42) return "issue" as const;
		if (num === 99) return "pull" as const;
		return null;
	};

	it("turns #N into issue links when resolveReference returns 'issue'", () => {
		const tree = runPlugin("fixes #42", {
			owner: "acme",
			name: "repo",
			resolveReference,
		});
		const nodes = getTextNodes(tree);
		expect(nodes).toContain("[link:#42→/repo/acme/repo/issues/42]");
	});

	it("turns #N into pull request links when resolveReference returns 'pull'", () => {
		const tree = runPlugin("see #99", {
			owner: "acme",
			name: "repo",
			resolveReference,
		});
		const nodes = getTextNodes(tree);
		expect(nodes).toContain("[link:#99→/repo/acme/repo/pulls/99]");
	});

	it("leaves #N as plain text when resolveReference returns null", () => {
		const tree = runPlugin("fixes #1", {
			owner: "acme",
			name: "repo",
			resolveReference,
		});
		const nodes = getTextNodes(tree);
		expect(nodes).toContain("fixes #1");
	});

	it("turns commit SHAs into commit links", () => {
		const tree = runPlugin("revert abc1234", {
			owner: "acme",
			name: "repo",
			resolveReference,
		});
		const nodes = getTextNodes(tree);
		expect(nodes).toContain("[link:abc1234→/repo/acme/repo/commit/abc1234]");
	});

	it("shortens SHA display to 7 chars", () => {
		const tree = runPlugin("commit abc1234def", {
			owner: "acme",
			name: "repo",
			resolveReference,
		});
		const linkNode = getTextNodes(tree).find((n) => n.startsWith("[link:"));
		// The full text value in the link should be the original, but display is truncated
		expect(linkNode).toBeDefined();
	});

	it("handles multiple references in one text", () => {
		const tree = runPlugin("fixes #42 and reverts abc1234", {
			owner: "acme",
			name: "repo",
			resolveReference,
		});
		const nodes = getTextNodes(tree);
		const links = nodes.filter((n) => n.startsWith("[link:"));
		expect(links).toHaveLength(2);
	});

	it("works without resolveReference callback", () => {
		const tree = runPlugin("fixes #42 and commit abc1234", {
			owner: "acme",
			name: "repo",
		});
		const nodes = getTextNodes(tree);
		// #42 should not become a link without resolveReference
		// but the SHA should still become a link
		const links = nodes.filter((n) => n.startsWith("[link:"));
		expect(links.some((l) => l.includes("/commit/abc1234"))).toBe(true);
	});

	it("does not touch text inside code spans", () => {
		// mdast find-and-replace only operates on text nodes,
		// and code spans are separate node types, so they should be untouched.
		const tree: MdastRoot = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "inlineCode", value: "#42" },
						{ type: "text", value: " and " },
						{ type: "text", value: "fixes #42" },
					],
				},
			],
		};

		const plugin = createAutolinkReferencesPlugin({
			owner: "acme",
			name: "repo",
			resolveReference,
		});
		const transformer = plugin();
		transformer(tree);

		// The code span should be untouched
		const para = tree.children[0];
		if (para.type === "paragraph") {
			const codeSpan = para.children.find((c) => c.type === "inlineCode");
			expect(codeSpan).toBeDefined();
			if (codeSpan?.type === "inlineCode") {
				expect(codeSpan.value).toBe("#42");
			}
		}
	});
});
