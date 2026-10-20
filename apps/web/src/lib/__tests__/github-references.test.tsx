/**
 * GitHub-flavored references through the real remark pipeline (parse → GFM →
 * our plugin → HTML), so "never inside code or existing links" is checked
 * against real mdast, not hand-built trees.
 */
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { createAutolinkReferencesPlugin } from "../remark-autolink-references";

const SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

function render(
	markdown: string,
	options: Parameters<typeof createAutolinkReferencesPlugin>[0] = {
		owner: "acme",
		name: "repo",
		resolveReference: (n) => (n === 7 ? "issue" : n === 8 ? "pull" : null),
	},
): string {
	return renderToStaticMarkup(
		<ReactMarkdown
			remarkPlugins={[remarkGfm, createAutolinkReferencesPlugin(options)]}
			urlTransform={(value) => value}
		>
			{markdown}
		</ReactMarkdown>,
	);
}

/** `[text](href)` for every anchor in the output. */
function links(markdown: string, options?: Parameters<typeof render>[1]) {
	const html = options ? render(markdown, options) : render(markdown);
	return [...html.matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map(
		(m) => `${m[2]}→${m[1]}`,
	);
}

describe("@mentions", () => {
	it("links a login to its profile", () => {
		expect(links("thanks @octocat!")).toEqual(["@octocat→/octocat"]);
		expect(links("@a-b_c.d works")).toEqual(["@a-b_c.d→/a-b_c.d"]);
	});

	it("drops trailing punctuation", () => {
		expect(links("hi @bob.")).toEqual(["@bob→/bob"]);
	});

	it("links without a repository context", () => {
		expect(links("@octocat", {})).toEqual(["@octocat→/octocat"]);
	});

	it("ignores emails", () => {
		expect(links("mail a@b.com or me@example.org")).toEqual([
			"a@b.com→mailto:a@b.com",
			"me@example.org→mailto:me@example.org",
		]);
	});

	it("ignores scoped packages and glued words", () => {
		expect(links("install @babel/core")).toEqual([]);
		expect(links("foo@bar")).toEqual([]);
		expect(links("@@bob")).toEqual([]);
	});

	it("ignores logins longer than 30 characters", () => {
		expect(links(`@${"a".repeat(31)}`)).toEqual([]);
	});
});

describe("#N and owner/repo#N", () => {
	it("links known issues and pull requests in this repository", () => {
		expect(links("fixes #7, see #8")).toEqual([
			"#7→/acme/repo/issues/7",
			"#8→/acme/repo/pulls/8",
		]);
	});

	it("leaves unknown numbers as text", () => {
		expect(links("see #1")).toEqual([]);
	});

	it("links owner/repo#N to the other repository", () => {
		expect(links("blocked by other/lib#12")).toEqual([
			"other/lib#12→/other/lib/issues/12",
		]);
	});

	it("resolves owner/repo#N for the current repo like #N", () => {
		expect(links("acme/repo#8 and acme/repo#99")).toEqual([
			"acme/repo#8→/acme/repo/pulls/8",
		]);
	});

	it("does not link #N glued to a word, path, or entity", () => {
		expect(links("a#7 /#7 &#7;")).toEqual([]);
		expect(render("see https://example.com/page#7")).not.toContain(
			"/acme/repo/issues/7",
		);
	});

	it("does not treat a path-like owner/repo#N with bad segments as a repo", () => {
		expect(links("x/-y#3")).toEqual([]);
	});
});

describe("commit SHAs", () => {
	it("links short SHAs (7+ hex) to this repository's commit, shown as 7", () => {
		expect(links("revert abc1234")).toEqual([
			"abc1234→/acme/repo/commit/abc1234",
		]);
		expect(links(`at ${SHA}`)).toEqual([
			`${SHA.slice(0, 7)}→/acme/repo/commit/${SHA}`,
		]);
	});

	it("ignores too short, too long, digitless and non-hex runs", () => {
		expect(links("abc123")).toEqual([]);
		expect(links(`${SHA}a`)).toEqual([]);
		expect(links("deadbeef cafebabe")).toEqual([]);
		expect(links("abc123g")).toEqual([]);
	});

	it("ignores all-digit runs such as dates and ids", () => {
		expect(links("released 20261019")).toEqual([]);
		expect(links("size 1234567 bytes")).toEqual([]);
		expect(links("other/lib@2026101")).toEqual([]);
	});

	it("ignores SHAs glued to words, paths or versions", () => {
		expect(links("x-abc1234 foo/abc1234 v1.abc1234")).toEqual([]);
	});

	it("links owner/repo@sha to the other repository's commit", () => {
		expect(links("from other/lib@abc1234")).toEqual([
			"other/lib@abc1234→/other/lib/commit/abc1234",
		]);
	});

	it("does not link owner/repo@sha with a short sha", () => {
		expect(links("other/lib@abc12")).toEqual([]);
	});

	it("does not link SHAs without a repository context", () => {
		expect(links("abc1234 #7", {})).toEqual([]);
	});
});

describe("never inside code or existing links", () => {
	it("leaves code spans and fences alone", () => {
		const html = render(
			"`@bob #7 abc1234`\n\n```\n@bob #7 abc1234 other/lib#1\n```",
		);
		expect(html).not.toContain("<a ");
	});

	it("leaves existing links and bare URLs alone", () => {
		expect(links("[@bob #7](https://example.com)")).toEqual([
			"@bob #7→https://example.com",
		]);
		expect(links("https://example.com/@bob/commit/abc1234#7")).toHaveLength(1);
	});

	it("emits no unsafe hrefs for hostile text", () => {
		const html = render("@javascript:alert(1) x/y#1 <script>");
		for (const m of html.matchAll(/href="([^"]*)"/g)) {
			expect(m[1]).toMatch(/^\/[A-Za-z0-9][A-Za-z0-9._-]*(\/|$)/);
		}
	});
});

describe("task lists", () => {
	it("renders disabled checkboxes", () => {
		const html = render("- [ ] todo\n- [x] done");
		expect(html.match(/<input[^>]*type="checkbox"[^>]*disabled/g)).toHaveLength(
			2,
		);
		expect(html.match(/checked=""/g)).toHaveLength(1);
	});
});
