/**
 * Database driver errors, recognised by their message. Plain server-only module
 * so both the repository and label code (and the REST API) can use it without
 * importing each other.
 */

const UNIQUE_VIOLATION = /UNIQUE constraint failed/;

/**
 * A unique index refused the row. D1 (SQLite) names it in the driver error,
 * which Drizzle keeps on `cause` beneath its own "Failed query" message.
 */
export function isUniqueViolation(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return (
		UNIQUE_VIOLATION.test(error.message) ||
		(error.cause instanceof Error && UNIQUE_VIOLATION.test(error.cause.message))
	);
}
