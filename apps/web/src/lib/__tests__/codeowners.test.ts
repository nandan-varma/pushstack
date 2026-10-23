import { describe, expect, it } from "vitest";
import {
	compilePattern,
	ownersOfPaths,
	parseCodeowners,
	ruleFor,
} from "../codeowners";

const matches = (pattern: string, path: string) =>
	compilePattern(pattern)(path);

describe("CODEOWNERS patterns", () => {
	it("matches a bare filename at any depth", () => {
		expect(matches("README.md", "README.md")).toBe(true);
		expect(matches("README.md", "docs/README.md")).toBe(true);
		expect(matches("README.md", "README.mdx")).toBe(false);
	});

	it("anchors patterns with a leading slash", () => {
		expect(matches("/build/logs/", "build/logs/a.log")).toBe(true);
		expect(matches("/build/logs/", "src/build/logs/a.log")).toBe(false);
		expect(matches("/README.md", "docs/README.md")).toBe(false);
	});

	it("treats a trailing slash as a directory at any depth", () => {
		expect(matches("apps/", "apps/a.ts")).toBe(true);
		expect(matches("apps/", "src/apps/deep/a.ts")).toBe(true);
		expect(matches("apps/", "apps")).toBe(false);
	});

	it("matches * within one segment and * as the last segment non-recursively", () => {
		expect(matches("*.js", "a.js")).toBe(true);
		expect(matches("*.js", "x/y/a.js")).toBe(true);
		expect(matches("*.js", "a.jsx")).toBe(false);
		expect(matches("docs/*", "docs/a.md")).toBe(true);
		expect(matches("docs/*", "docs/sub/a.md")).toBe(false);
		expect(matches("*", "any/where.txt")).toBe(true);
	});

	it("supports ** in the three positions", () => {
		expect(matches("**/logs", "logs/a")).toBe(true);
		expect(matches("**/logs", "x/y/logs/a")).toBe(true);
		expect(matches("docs/**", "docs/a/b.md")).toBe(true);
		expect(matches("a/**/b.md", "a/b.md")).toBe(true);
		expect(matches("a/**/b.md", "a/x/y/b.md")).toBe(true);
		expect(matches("a/**/b.md", "c/a/b.md")).toBe(false);
	});

	it("matches inner-slash patterns from the root and covers a directory's files", () => {
		expect(matches("docs/guide", "docs/guide/a.md")).toBe(true);
		expect(matches("docs/guide", "x/docs/guide/a.md")).toBe(false);
	});

	it("matches nothing for syntax GitHub rejects", () => {
		expect(matches("!a.js", "a.js")).toBe(false);
		expect(matches("[ab].js", "a.js")).toBe(false);
	});
});

describe("CODEOWNERS files", () => {
	const rules = parseCodeowners(`# comment
* @alice @org/team stranger@example.com

*.ts @Bob   # trailing comment
/docs/ @carol
/docs/private/
`);

	it("keeps users only (lower-cased), skipping teams, e-mails and comments", () => {
		expect(rules.map((r) => [r.pattern, r.owners, r.line])).toEqual([
			["*", ["alice"], 2],
			["*.ts", ["bob"], 4],
			["/docs/", ["carol"], 5],
			["/docs/private/", [], 6],
		]);
	});

	it("lets the last matching line win, even with no owners", () => {
		expect(ruleFor(rules, "README.md")?.owners).toEqual(["alice"]);
		expect(ruleFor(rules, "src/a.ts")?.owners).toEqual(["bob"]);
		expect(ruleFor(rules, "docs/a.md")?.owners).toEqual(["carol"]);
		expect(ruleFor(rules, "docs/private/key")?.owners).toEqual([]);
	});

	it("unions the owners of several paths without duplicates", () => {
		expect(
			ownersOfPaths(rules, ["src/a.ts", "docs/a.md", "src/b.ts", "x"]),
		).toEqual(["bob", "carol", "alice"]);
	});
});

describe("pathological patterns", () => {
	it("stays fast on many wildcards against a long non-matching path", () => {
		const started = performance.now();
		expect(matches(`${"**a".repeat(12)}b`, "a".repeat(300))).toBe(false);
		expect(matches(`${"*a".repeat(30)}b`, "a".repeat(900))).toBe(false);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("matches nothing for over-long patterns and keeps a rule cap", () => {
		expect(matches("a".repeat(300), "a".repeat(300))).toBe(false);
		const many = parseCodeowners("*.a @x\n".repeat(5000));
		expect(many.length).toBeLessThanOrEqual(1000);
	});
});
