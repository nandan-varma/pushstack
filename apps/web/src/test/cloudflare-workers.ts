/**
 * Stand-in for the `cloudflare:workers` module under vitest (see
 * vitest.config.ts), where there is no workerd runtime.
 *
 * `env` has the shape of a deployed Worker's: the R2 binding is an in-memory
 * bucket, the D1 binding refuses use (database tests build their own with
 * `createTestDb` and mock `#/db`), and a string variable reads `process.env`
 * first, so a test configures one by assigning it, as it always has.
 */
import { createFakeR2Bucket } from "git-fs-s3/testing";
import { LeaseQueue } from "../server/repository-lock/lease-queue";
import { LOCK_LEASE_MS } from "../server/repository-lock/settings";

/** The Worker's repository bucket; tests read it to assert what was stored. */
export const gitBucket = createFakeR2Bucket();

function refuseDatabase(): never {
	throw new Error(
		"The test Worker env has no database; mock `#/db` with createTestDb() from src/test/test-db.ts",
	);
}

const unavailableDatabase: D1Database = {
	prepare: refuseDatabase,
	batch: refuseDatabase,
	exec: refuseDatabase,
};

/** In-memory stand-in for the RepositoryLock namespace: same queue, no workerd. */
const repositoryLocks = new Map<string, LeaseQueue>();

const lockNamespace: DurableObjectNamespace = {
	idFromName: (name) => ({ toString: () => name }),
	get: (id) => {
		const name = id.toString();
		const queue =
			repositoryLocks.get(name) ?? new LeaseQueue({ leaseMs: LOCK_LEASE_MS });
		repositoryLocks.set(name, queue);
		return {
			acquire: async (timeoutMs) => (await queue.acquire(timeoutMs)).token,
			renew: async (token) => queue.renew(token),
			release: async (token) => queue.release(token),
		};
	},
};

const defaults: Cloudflare.Env = {
	REPO_LOCK: lockNamespace,
	GIT_BUCKET: gitBucket,
	DB: unavailableDatabase,
	ENVIRONMENT: "test",
	BETTER_AUTH_URL: "http://localhost:3000",
	BETTER_AUTH_SECRET: "test-better-auth-secret-with-32-plus-characters",
	R2_BUCKET_NAME: "test-bucket",
	R2_ENDPOINT: "https://test.r2.cloudflarestorage.com",
};

export const env: Cloudflare.Env = new Proxy(defaults, {
	get: (target, name, receiver) =>
		(typeof name === "string" ? process.env[name] : undefined) ??
		Reflect.get(target, name, receiver),
});
