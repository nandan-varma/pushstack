import { getTableColumns } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteInsertValue, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "#/db";

/** D1's cap on bound parameters in one statement. */
const MAX_BOUND_PARAMETERS = 100;

/** A statement under construction, before any conflict clause. */
type PendingInsert<T extends SQLiteTable> = ReturnType<
	ReturnType<typeof db.insert<T>>["values"]
>;

/**
 * Insert any number of rows, split into statements that each stay under D1's
 * bound-parameter cap (a row spends up to one parameter per column) and sent
 * as one batch, which D1 runs atomically: either every row lands or none do
 * (`onConflict` adds a conflict clause, e.g. `(insert) =>
 * insert.onConflictDoNothing()`, to every statement; by default a row colliding
 * with a unique index fails the insert).
 */
export async function insertMany<T extends SQLiteTable>(
	table: T,
	rows: readonly SQLiteInsertValue<T>[],
	options: {
		onConflict?: (insert: PendingInsert<T>) => BatchItem<"sqlite">;
	} = {},
): Promise<void> {
	const [first, ...rest] = chunk(rows, rowsPerStatement(table));
	if (!first) return;
	const statement = (values: typeof first) => {
		const insert = db.insert(table).values(values);
		return options.onConflict ? options.onConflict(insert) : insert;
	};
	await db.batch([statement(first), ...rest.map(statement)]);
}

function rowsPerStatement(table: SQLiteTable): number {
	const columns = Object.keys(getTableColumns(table)).length;
	return Math.max(1, Math.floor(MAX_BOUND_PARAMETERS / columns));
}

function chunk<R>(items: readonly R[], size: number): R[][] {
	const chunks: R[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}
