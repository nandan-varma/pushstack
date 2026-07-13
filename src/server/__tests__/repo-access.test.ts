/**
 * Tests for repo-access.ts — the single place that computes RepositoryAccess
 * (owner/admin/write/read/anonymous role, canRead/canWrite/canModerate flags)
 * for every repo read/write/moderate check across the app (git-auth, files,
 * issues, repositories). A regression here is a silent authz bug, so this
 * exercises the real role matrix against a real relational database rather
 * than mocking db.query return values by hand.
 *
 * Postgres is replaced with an in-memory embedded Postgres (pglite), seeded
 * with the project's real drizzle schema — same pattern as
 * git-user-lifecycle.test.ts — so every query in repo-access.ts runs for
 * real, including the where-clause logic itself.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../db", async () => {
	const { PGlite } = await import("@electric-sql/pglite");
	const { drizzle } = await import("drizzle-orm/pglite");
	const { pushSchema } = await import("drizzle-kit/api");
	const schema = await import("../../db/schema");

	const client = new PGlite();
	const db = drizzle(client, { schema });
	const { apply } = await pushSchema(
		schema as unknown as Record<string, unknown>,
		db as unknown as Parameters<typeof pushSchema>[1],
	);
	await apply();

	return { db };
});

const OWNER = "repo-access-owner";
const ADMIN_COLLAB = "repo-access-admin";
const WRITE_COLLAB = "repo-access-write";
const READ_COLLAB = "repo-access-read";
const OUTSIDER = "repo-access-outsider";

let PUBLIC_REPO_ID: number;
let PRIVATE_REPO_ID: number;

beforeAll(async () => {
	const { db } = await import("../../db");
	const { user, repositories, repositoryCollaborators } = await import(
		"../../db/schema"
	);

	for (const id of [OWNER, ADMIN_COLLAB, WRITE_COLLAB, READ_COLLAB, OUTSIDER]) {
		await db.insert(user).values({
			id,
			email: `${id}@example.com`,
			name: id,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}

	const [publicRepo] = await db
		.insert(repositories)
		.values({ ownerId: OWNER, name: "public-repo", visibility: "public" })
		.returning();
	const [privateRepo] = await db
		.insert(repositories)
		.values({ ownerId: OWNER, name: "private-repo", visibility: "private" })
		.returning();
	PUBLIC_REPO_ID = publicRepo.id;
	PRIVATE_REPO_ID = privateRepo.id;

	await db.insert(repositoryCollaborators).values([
		{ repoId: PRIVATE_REPO_ID, userId: ADMIN_COLLAB, role: "admin" },
		{ repoId: PRIVATE_REPO_ID, userId: WRITE_COLLAB, role: "write" },
		{ repoId: PRIVATE_REPO_ID, userId: READ_COLLAB, role: "read" },
	]);
});

const { getRepositoryAccess, canReadRepo, canWriteRepo, canModerateRepo, canMergePullRequest } =
	await import("../repo-access");

describe("getRepositoryAccess", () => {
	it("grants full access to the owner, on both public and private repos", async () => {
		for (const repoId of [PUBLIC_REPO_ID, PRIVATE_REPO_ID]) {
			const access = await getRepositoryAccess(repoId, OWNER);
			expect(access?.role).toBe("owner");
			expect(access).toMatchObject({
				canRead: true,
				canWrite: true,
				canModerate: true,
				canMergePullRequest: true,
			});
		}
	});

	it("grants full access to an admin collaborator", async () => {
		const access = await getRepositoryAccess(PRIVATE_REPO_ID, ADMIN_COLLAB);
		expect(access?.role).toBe("admin");
		expect(access).toMatchObject({
			canRead: true,
			canWrite: true,
			canModerate: true,
			canMergePullRequest: true,
		});
	});

	it("grants read+write but not moderate to a write collaborator", async () => {
		const access = await getRepositoryAccess(PRIVATE_REPO_ID, WRITE_COLLAB);
		expect(access?.role).toBe("write");
		expect(access).toMatchObject({
			canRead: true,
			canWrite: true,
			canModerate: false,
			canMergePullRequest: true,
		});
	});

	it("grants only read to a read collaborator", async () => {
		const access = await getRepositoryAccess(PRIVATE_REPO_ID, READ_COLLAB);
		expect(access?.role).toBe("read");
		expect(access).toMatchObject({
			canRead: true,
			canWrite: false,
			canModerate: false,
			canMergePullRequest: false,
		});
	});

	it("denies a non-collaborator on a private repo, even when authenticated", async () => {
		const access = await getRepositoryAccess(PRIVATE_REPO_ID, OUTSIDER);
		expect(access?.role).toBe("anonymous");
		expect(access?.canRead).toBe(false);
		expect(access?.canWrite).toBe(false);
	});

	it("denies an unauthenticated caller on a private repo", async () => {
		const access = await getRepositoryAccess(PRIVATE_REPO_ID, null);
		expect(access?.canRead).toBe(false);
	});

	it("allows an unauthenticated caller to read a public repo", async () => {
		const access = await getRepositoryAccess(PUBLIC_REPO_ID, null);
		expect(access?.role).toBe("anonymous");
		expect(access?.canRead).toBe(true);
		expect(access?.canWrite).toBe(false);
	});

	it("allows a non-collaborator authenticated caller to read a public repo", async () => {
		const access = await getRepositoryAccess(PUBLIC_REPO_ID, OUTSIDER);
		expect(access?.role).toBe("anonymous");
		expect(access?.canRead).toBe(true);
	});

	it("returns null for a repository that doesn't exist", async () => {
		const access = await getRepositoryAccess(999_999, OWNER);
		expect(access).toBeNull();
	});
});

describe("canReadRepo / canWriteRepo / canModerateRepo / canMergePullRequest", () => {
	it("delegate to getRepositoryAccess for a write collaborator", async () => {
		expect(await canReadRepo(PRIVATE_REPO_ID, WRITE_COLLAB)).toBe(true);
		expect(await canWriteRepo(PRIVATE_REPO_ID, WRITE_COLLAB)).toBe(true);
		expect(await canModerateRepo(PRIVATE_REPO_ID, WRITE_COLLAB)).toBe(false);
		expect(await canMergePullRequest(PRIVATE_REPO_ID, WRITE_COLLAB)).toBe(true);
	});

	it("return false across the board for a missing repository", async () => {
		expect(await canReadRepo(999_999, OWNER)).toBe(false);
		expect(await canWriteRepo(999_999, OWNER)).toBe(false);
		expect(await canModerateRepo(999_999, OWNER)).toBe(false);
		expect(await canMergePullRequest(999_999, OWNER)).toBe(false);
	});
});
