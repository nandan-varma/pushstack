/**
 * Git-specific error types for proper error handling and HTTP status mapping
 */

export class GitError extends Error {
	statusCode: number;
	retryable: boolean;

	constructor(
		message: string,
		statusCode: number = 500,
		retryable: boolean = false,
	) {
		super(message);
		this.name = this.constructor.name;
		this.statusCode = statusCode;
		this.retryable = retryable;
		Error.captureStackTrace(this, this.constructor);
	}

	toJSON() {
		return {
			error: this.name,
			message: this.message,
			statusCode: this.statusCode,
			retryable: this.retryable,
		};
	}
}

/**
 * Git path (file/directory) not found within the tree (404)
 */
export class GitPathNotFoundError extends GitError {
	constructor(message: string) {
		super(message, 404, false);
	}
}

/**
 * Git object not found (404)
 */
export class GitObjectNotFoundError extends GitError {
	constructor(message: string) {
		super(message, 404, false);
	}
}

/**
 * Git ref (branch/tag) not found (404)
 */
export class GitRefNotFoundError extends GitError {
	constructor(message: string) {
		super(message, 404, false);
	}
}

/**
 * Git repository not found (404)
 */
export class GitRepositoryNotFoundError extends GitError {
	constructor(message: string) {
		super(message, 404, false);
	}
}

/**
 * Git merge conflict (409)
 */
export class GitConflictError extends GitError {
	conflicts: Array<{
		file: string;
		baseLines?: string[];
		sourceLines?: string[];
		targetLines?: string[];
	}>;

	constructor(
		message: string,
		conflicts: Array<{
			file: string;
			baseLines?: string[];
			sourceLines?: string[];
			targetLines?: string[];
		}> = [],
	) {
		super(message, 409, false);
		this.conflicts = conflicts;
	}

	toJSON() {
		return {
			...super.toJSON(),
			conflicts: this.conflicts,
		};
	}
}

/**
 * Git authentication failed (401)
 */
export class GitAuthenticationError extends GitError {
	constructor(message: string) {
		super(message, 401, false);
	}
}

/**
 * Git authorization failed (403)
 */
export class GitAuthorizationError extends GitError {
	constructor(message: string) {
		super(message, 403, false);
	}
}

/**
 * Too many failed authentication attempts (429)
 */
export class GitRateLimitError extends GitError {
	constructor(message: string) {
		super(message, 429, false);
	}
}

/**
 * Git invalid request (400)
 */
export class GitInvalidRequestError extends GitError {
	constructor(message: string) {
		super(message, 400, false);
	}
}

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
 * Git protocol error (400)
 */
export class GitProtocolError extends GitError {
	constructor(message: string) {
		super(message, 400, false);
	}
}

/**
 * Format error for HTTP response
 */
export function formatErrorResponse(error: unknown): {
	status: number;
	body: Record<string, unknown>;
	headers?: Record<string, string>;
} {
	if (error instanceof GitError) {
		return {
			status: error.statusCode,
			body: error.toJSON(),
			// Git clients need WWW-Authenticate to know to prompt for credentials
			headers:
				error.statusCode === 401
					? { "WWW-Authenticate": 'Basic realm="Git Repository"' }
					: undefined,
		};
	}

	// Handle standard errors
	if (error instanceof Error) {
		return {
			status: 500,
			body: {
				error: "InternalServerError",
				message: "An internal error occurred",
				retryable: true,
			},
		};
	}

	// Unknown error type
	return {
		status: 500,
		body: {
			error: "UnknownError",
			message: "An unknown error occurred",
			retryable: true,
		},
	};
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
