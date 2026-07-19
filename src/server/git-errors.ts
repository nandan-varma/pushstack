/**
 * Git-specific error types for proper error handling and HTTP status mapping.
 *
 * The shared hierarchy (GitError, its 4xx subclasses, and formatErrorResponse)
 * is re-exported from @nandan-varma/git-fs-s3 — extracted from an earlier
 * version of this exact file — so it stays a single class hierarchy: the
 * library's own ops/http functions throw these same classes internally
 * (e.g. getFileContent's GitPathNotFoundError), and `error instanceof
 * GitError` here needs to recognize those, not just errors pushstack's own
 * code constructs. R2UploadError/R2DownloadError/isRetryableError/
 * isR2NotFoundError are R2-specific and stay local — the library has no R2
 * concept.
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
} from "@nandan-varma/git-fs-s3";

import { GitError } from "@nandan-varma/git-fs-s3";

/**
 * R2 upload error (500, retryable)
 */
export class R2UploadError extends GitError {
	constructor(message: string, retryable: boolean = true) {
		super(message, 500, retryable);
	}
}

/**
 * R2 download error (500, retryable)
 */
export class R2DownloadError extends GitError {
	constructor(message: string, retryable: boolean = true) {
		super(message, 500, retryable);
	}
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof GitError) {
		return error.retryable;
	}

	// Network errors are generally retryable
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			message.includes("network") ||
			message.includes("timeout") ||
			message.includes("econnrefused") ||
			message.includes("econnreset")
		);
	}

	return false;
}

/**
 * Duck-typed check for R2/S3 "not found" errors. Deliberately doesn't rely on
 * `instanceof S3ServiceException` — the R2 backend treats `#/lib/r2-operations`
 * as an opaque boundary, and tests mock it with plain objects/Errors carrying
 * just `name`/`$metadata`, not real AWS SDK exception instances.
 */
export function isR2NotFoundError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const err = error as {
		name?: unknown;
		$metadata?: { httpStatusCode?: unknown };
	};
	return err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404;
}
