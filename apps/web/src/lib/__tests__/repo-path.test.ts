import { describe, expect, it } from "vitest";
import { resolveRepoRelativePath } from "../repo-path";

describe("resolveRepoRelativePath", () => {
	it("resolves a sibling target against the containing file's directory", () => {
		expect(resolveRepoRelativePath("docs/README.md", "./diagram.png")).toBe(
			"docs/diagram.png",
		);
		expect(resolveRepoRelativePath("docs/README.md", "diagram.png")).toBe(
			"docs/diagram.png",
		);
		expect(resolveRepoRelativePath("docs/guides/intro.md", "../a/b.png")).toBe(
			"docs/a/b.png",
		);
	});

	it("resolves against the root for a root-level file", () => {
		expect(resolveRepoRelativePath("README.md", "./assets/x.png")).toBe(
			"assets/x.png",
		);
		expect(resolveRepoRelativePath("", "./assets/x.png")).toBe("assets/x.png");
	});

	it("treats a leading slash as repository-absolute, ignoring the file", () => {
		expect(resolveRepoRelativePath("docs/README.md", "/assets/x.png")).toBe(
			"assets/x.png",
		);
		expect(resolveRepoRelativePath("", "/a/./b/../c.png")).toBe("a/c.png");
	});

	it("drops empty and dot segments", () => {
		expect(resolveRepoRelativePath("", "a//b/./c.png")).toBe("a/b/c.png");
		expect(resolveRepoRelativePath("docs/", "./x.png")).toBe("docs/x.png");
	});

	it("returns null when the target climbs above the repository root", () => {
		expect(resolveRepoRelativePath("", "../secret.png")).toBeNull();
		expect(resolveRepoRelativePath("README.md", "../../x")).toBeNull();
		expect(resolveRepoRelativePath("docs/README.md", "../../x")).toBeNull();
		expect(resolveRepoRelativePath("docs/a/b.md", "../../x")).toBe("x");
		expect(resolveRepoRelativePath("a/b.md", "../../../x")).toBeNull();
	});

	it("keeps characters that are legal in a repository path", () => {
		expect(resolveRepoRelativePath("", "a b/c\\d.png")).toBe("a b/c\\d.png");
		expect(resolveRepoRelativePath("", "x:y.png")).toBe("x:y.png");
	});
});
