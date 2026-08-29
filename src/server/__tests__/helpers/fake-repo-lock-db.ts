/**
 * Shared fake `db` for tests exercising withRepositoryLock (git-repo-storage.ts)
 * without a real Postgres connection. Mirrors the actual single-round-trip CAS
 * semantics of acquireRepoLock/releaseRepoLock — `INSERT ... ON CONFLICT DO
 * UPDATE ... WHERE expires_at < now() RETURNING`, and a holder-scoped DELETE —
 * against an in-memory Map, so tests get real acquire/expire/release behavior
 * without needing a reachable database. Used by any test file that exercises
 * a write path (createCommit, createBranch, push, merge, ...) but isn't itself
 * testing lock semantics in detail (git-repo-storage.test.ts hand-rolls its
 * own copy of this for that reason — see its own comments).
 *
 * Pair with mockRepoLockDrizzleOrm (swaps `eq`/`and` for inspectable markers)
 * via `vi.mock("drizzle-orm", ...)`, since the real SQL condition objects
 * aren't introspectable from a mock.
 *
 * `insert().values(row)` also has to work for git-transactions.ts's plain
 * `db.insert(gitTransactions).values({...})` (no `.onConflictDoUpdate()`) —
 * every real write now goes through withRepositoryLock, which logs a WAL
 * entry alongside acquiring the lock (see git-transactions.ts), so any test
 * exercising a real write path hits both. This fake doesn't model the WAL
 * table's contents (nothing here asserts against it); it just needs the
 * call to resolve instead of throwing.
 */

export type LockRow = { holder: string; expiresAt: number };

export function createRepoLockStore(): Map<string, LockRow> {
	return new Map();
}

type Condition = { kind: string; conditions?: Array<{ value: unknown }> };

function conditionValues(condition: Condition): unknown[] {
	return condition.kind === "and"
		? (condition.conditions ?? []).map((c) => c.value)
		: [];
}

export function createFakeRepoLockDb(lockStore: Map<string, LockRow>) {
	return {
		insert: () => ({
			values: (row: Record<string, unknown>) =>
				Object.assign(Promise.resolve(undefined), {
					onConflictDoUpdate: () => ({
						returning: async () => {
							const repoKey = row.repoKey as string;
							const holder = row.holder as string;
							const expiresAt = row.expiresAt as Date;
							const existing = lockStore.get(repoKey);
							if (!existing || existing.expiresAt <= Date.now()) {
								lockStore.set(repoKey, {
									holder,
									expiresAt: expiresAt.getTime(),
								});
								return [{ holder }];
							}
							return [];
						},
					}),
				}),
		}),
		delete: () => ({
			where: async (condition: Condition) => {
				const [repoKey, holder] = conditionValues(condition);
				if (
					typeof repoKey === "string" &&
					lockStore.get(repoKey)?.holder === holder
				) {
					lockStore.delete(repoKey);
				}
			},
		}),
		update: () => ({
			set: () => ({
				where: () => Promise.resolve(),
			}),
		}),
	};
}

/** Pass as the `drizzle-orm` mock factory's return, spread over `importOriginal()`. */
export function fakeRepoLockDrizzleOrmOverrides() {
	return {
		eq: (column: unknown, value: unknown) => ({
			kind: "eq" as const,
			column,
			value,
		}),
		and: (...conditions: unknown[]) => ({ kind: "and" as const, conditions }),
		lt: (column: unknown, value: unknown) => ({
			kind: "lt" as const,
			column,
			value,
		}),
	};
}
