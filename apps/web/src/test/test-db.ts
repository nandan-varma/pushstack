/**
 * A real D1 database holding the app's schema, for behavior tests. Each call
 * boots its own Miniflare (workerd's D1 implementation, the engine that runs in
 * production), applies `migrations/` in order, and returns a drizzle client.
 * Every test file therefore starts from an empty database. Use from a
 * `vi.mock("#/db", …)` factory:
 *   vi.mock("#/db", async () => ({ db: await (await import("<relative path to src/test/test-db>")).createTestDb() }));
 *
 * Instances are disposed when the file's tests finish (src/test/setup.ts).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { relations } from "#/db/relations";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");

/** drizzle-kit separates the statements of one migration with this marker. */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

const instances = new Set<Miniflare>();

/** Every migration statement, in the order wrangler would apply them. */
function migrationStatements(): string[] {
	return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
		.flatMap((folder) =>
			readFileSync(path.join(MIGRATIONS_DIR, folder, "migration.sql"), "utf8")
				.split(STATEMENT_BREAKPOINT)
				.map((statement) => statement.trim())
				.filter((statement) => statement !== ""),
		);
}

export async function createTestDb(options?: {
	/** Called with every query's SQL text (query-count tests). */
	onQuery?: (query: string) => void;
}) {
	const miniflare = new Miniflare({
		modules: true,
		script: "export default {}",
		// Only D1 is used, so the date just has to be one this workerd supports.
		compatibilityDate: "2026-08-01",
		d1Databases: { DB: crypto.randomUUID() },
	});
	instances.add(miniflare);
	const d1 = await miniflare.getD1Database("DB");
	await d1.batch(
		migrationStatements().map((statement) => d1.prepare(statement)),
	);
	const { onQuery } = options ?? {};
	return drizzle(onQuery ? observed(d1, onQuery) : d1, { relations });
}

/**
 * The same database, reporting every statement's SQL text as it is prepared.
 * Watching the binding rather than drizzle's logger sees statements sent
 * through `db.batch` too, and a throw from `onQuery` fails the statement
 * before it runs (before the whole batch, when it is part of one).
 */
function observed(
	d1: D1Database,
	onQuery: (query: string) => void,
): D1Database {
	return {
		prepare(query) {
			onQuery(query);
			return d1.prepare(query);
		},
		batch: (statements) => d1.batch(statements),
		exec: (query) => d1.exec(query),
	};
}

/** Shuts down every database this worker booted. */
export async function disposeTestDbs(): Promise<void> {
	const open = [...instances];
	instances.clear();
	await Promise.all(open.map((miniflare) => miniflare.dispose()));
}
