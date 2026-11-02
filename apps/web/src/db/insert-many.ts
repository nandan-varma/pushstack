import { getTableColumns } from "drizzle-orm";
import type { SQLiteInsertValue, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "#/db";

/** D1's cap on bound parameters in one statement. */
const MAX_BOUND_PARAMETERS = 100;

/**
 * Insert any number of rows, split into statements that each stay under D1's
 * bound-parameter cap (a row spends up to one parameter per column) and sent
 * as one batch, which D1 runs atomically: either every row lands or none do.
 */
export async function insertMany<T extends SQLiteTable>(
	table: T,
	rows: readonly SQLiteInsertValue<T>[],
): Promise<void> {
	const [first, ...rest] = chunk(rows, rowsPerStatement(table));
	if (!first) return;
	await db.batch([
		db.insert(table).values(first),
		...rest.map((values) => db.insert(table).values(values)),
	]);
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
