import { describe, expect, it } from "vitest";
import { findReadmeFile } from "../ReadmeCard";

// `files` is always scoped to a single directory (server lists entries for
// whatever path was requested), so file.path is the full repo-relative path
// (e.g. "docs/README.md") — matching had to be done against the basename to
// find a README in any directory, not just when it sits at the repo root.
describe("findReadmeFile", () => {
	it("finds a README at the repo root", () => {
		const files = [
			{ type: "blob" as const, path: "README.md" },
			{ type: "blob" as const, path: "package.json" },
		];
		expect(findReadmeFile(files)?.path).toBe("README.md");
	});

	it("finds a README nested inside a subdirectory", () => {
		const files = [
			{ type: "blob" as const, path: "docs/README.md" },
			{ type: "blob" as const, path: "docs/guide.md" },
			{ type: "tree" as const, path: "docs/assets" },
		];
		expect(findReadmeFile(files)?.path).toBe("docs/README.md");
	});

	it("matches case-insensitively", () => {
		const files = [{ type: "blob" as const, path: "src/readme.MD" }];
		expect(findReadmeFile(files)?.path).toBe("src/readme.MD");
	});

	it("does not match a directory literally named README.md", () => {
		const files = [{ type: "tree" as const, path: "README.md" }];
		expect(findReadmeFile(files)).toBeUndefined();
	});

	it("does not match a file that merely ends with readme.md as a substring", () => {
		const files = [{ type: "blob" as const, path: "notreadme.md" }];
		expect(findReadmeFile(files)).toBeUndefined();
	});

	it("returns undefined when there are no files", () => {
		expect(findReadmeFile(undefined)).toBeUndefined();
	});
});
