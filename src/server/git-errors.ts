/**
 * Git-specific error types for proper error handling and HTTP status mapping.
 *
 * The shared hierarchy (GitError, its 4xx subclasses, and formatErrorResponse)
 * is re-exported from git-fs-s3 — extracted from an earlier
 * version of this exact file — so it stays a single class hierarchy: the
 * library's own ops/http functions throw these same classes internally
 * (e.g. getFileContent's GitPathNotFoundError), and `error instanceof
 * GitError` here needs to recognize those, not just errors pushstack's own
 * code constructs.
 */
export {
	formatErrorResponse,
	GitAuthenticationError,
	GitAuthorizationError,
	GitConflictError,
	GitError,
	GitInvalidRequestError,
	GitObjectNotFoundError,
	GitPathNotFoundError,
	GitProtocolError,
	GitRateLimitError,
	GitRefNotFoundError,
	GitRepositoryNotFoundError,
	type MergeConflictDetail,
} from "git-fs-s3";

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
