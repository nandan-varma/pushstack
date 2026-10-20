/**
 * Postgres driver errors, recognised by SQLSTATE. Plain server-only module so
 * both the repository and label code (and the REST API) can use it without
 * importing each other.
 */

/** Postgres SQLSTATE 23505 (unique violation); Drizzle keeps it on `cause`. */
export function isUniqueViolation(error: unknown): boolean {
	const err = error as { code?: unknown; cause?: { code?: unknown } } | null;
	return err?.code === "23505" || err?.cause?.code === "23505";
}
