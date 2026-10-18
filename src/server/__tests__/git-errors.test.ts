import {
	GitConflictError,
	GitObjectNotFoundError,
	GitPathNotFoundError,
	GitRefNotFoundError,
	GitRepositoryNotFoundError,
} from "git-fs-s3";
import { describe, expect, it } from "vitest";
import { isGitNotFoundError } from "../git-errors";

describe("isGitNotFoundError", () => {
	it("is true for a missing repository, ref, path or object", () => {
		for (const error of [
			new GitRepositoryNotFoundError("r"),
			new GitRefNotFoundError("r"),
			new GitPathNotFoundError("p"),
			new GitObjectNotFoundError("o"),
		]) {
			expect(isGitNotFoundError(error)).toBe(true);
		}
	});

	it("is false for anything else", () => {
		expect(isGitNotFoundError(new GitConflictError("c"))).toBe(false);
		expect(isGitNotFoundError(new Error("x"))).toBe(false);
		expect(isGitNotFoundError(null)).toBe(false);
	});
});
