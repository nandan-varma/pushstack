import {
	GitObjectNotFoundError,
	GitPathNotFoundError,
	GitRefNotFoundError,
	GitRepositoryNotFoundError,
} from "git-fs-s3";

/** A missing repository, ref, path or object: on a read path that's a 404. */
export function isGitNotFoundError(error: unknown): boolean {
	return (
		error instanceof GitPathNotFoundError ||
		error instanceof GitObjectNotFoundError ||
		error instanceof GitRefNotFoundError ||
		error instanceof GitRepositoryNotFoundError
	);
}
