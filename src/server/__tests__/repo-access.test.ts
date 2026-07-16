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

const {
	getRepositoryAccess,
	canReadRepo,
	canWriteRepo,
	canModerateRepo,
	canMergePullRequest,
	getAccessForRepository,
	getRepoOrThrow,
	getRepoWithReadAccess,
	getRepoWithWriteAccess,
	requireReadAccess,
	requireWriteAccess,
} = await import("../repo-access");

const { db } = await import("../../db");
const { repositories } = await import("../../db/schema");

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

	it("canReadRepo returns true for public repo with null userId", async () => {
		expect(await canReadRepo(PUBLIC_REPO_ID, null)).toBe(true);
	});

	it("canWriteRepo returns false for public repo with null userId", async () => {
		expect(await canWriteRepo(PUBLIC_REPO_ID, null)).toBe(false);
	});
});

describe("getAccessForRepository", () => {
	it("returns owner access when userId matches repository ownerId", async () => {
		const repo = await db.query.repositories.findFirst({
			where: (repos, { eq }) => eq(repos.id, PRIVATE_REPO_ID),
		});
		expect(repo).toBeDefined();

		const access = await getAccessForRepository(repo!, OWNER);
		expect(access.role).toBe("owner");
		expect(access.canWrite).toBe(true);
	});

	it("returns owner access without querying collaborators when userId matches ownerId", async () => {
		const repo = await db.query.repositories.findFirst({
			where: (repos, { eq }) => eq(repos.id, PRIVATE_REPO_ID),
		});
		expect(repo).toBeDefined();

		const access = await getAccessForRepository(repo!, OWNER);
		expect(access.collaboratorRole).toBeNull();
		expect(access.role).toBe("owner");
	});

	it("queries collaborators for non-owner userId", async () => {
		const repo = await db.query.repositories.findFirst({
			where: (repos, { eq }) => eq(repos.id, PRIVATE_REPO_ID),
		});
		expect(repo).toBeDefined();

		const access = await getAccessForRepository(repo!, WRITE_COLLAB);
		expect(access.role).toBe("write");
		expect(access.collaboratorRole).toBe("write");
	});

	it("returns anonymous for null userId on private repo", async () => {
		const repo = await db.query.repositories.findFirst({
			where: (repos, { eq }) => eq(repos.id, PRIVATE_REPO_ID),
		});
		expect(repo).toBeDefined();

		const access = await getAccessForRepository(repo!, null);
		expect(access.role).toBe("anonymous");
		expect(access.canRead).toBe(false);
	});

	it("returns anonymous read for null userId on public repo", async () => {
		const repo = await db.query.repositories.findFirst({
			where: (repos, { eq }) => eq(repos.id, PUBLIC_REPO_ID),
		});
		expect(repo).toBeDefined();

		const access = await getAccessForRepository(repo!, null);
		expect(access.role).toBe("anonymous");
		expect(access.canRead).toBe(true);
	});
});

describe("getRepoOrThrow", () => {
	it("returns the repository when it exists", async () => {
		const repo = await getRepoOrThrow(PRIVATE_REPO_ID);
		expect(repo.id).toBe(PRIVATE_REPO_ID);
		expect(repo.name).toBe("private-repo");
	});

	it("throws when the repository does not exist", async () => {
		await expect(getRepoOrThrow(999_999)).rejects.toThrow(
			"Repository not found",
		);
	});
});

describe("getRepoWithReadAccess", () => {
	it("returns the repository for an owner", async () => {
		const repo = await getRepoWithReadAccess(PRIVATE_REPO_ID, OWNER);
		expect(repo.id).toBe(PRIVATE_REPO_ID);
	});

	it("returns the repository for a read collaborator", async () => {
		const repo = await getRepoWithReadAccess(PRIVATE_REPO_ID, READ_COLLAB);
		expect(repo.id).toBe(PRIVATE_REPO_ID);
	});

	it("throws 'Repository not found' for a missing repo", async () => {
		await expect(getRepoWithReadAccess(999_999, OWNER)).rejects.toThrow(
			"Repository not found",
		);
	});

	it("throws 'Access denied' for a non-collaborator on a private repo", async () => {
		await expect(
			getRepoWithReadAccess(PRIVATE_REPO_ID, OUTSIDER),
		).rejects.toThrow("Access denied");
	});

	it("returns the repository for unauthenticated user on public repo", async () => {
		const repo = await getRepoWithReadAccess(PUBLIC_REPO_ID, null);
		expect(repo.id).toBe(PUBLIC_REPO_ID);
	});
});

describe("getRepoWithWriteAccess", () => {
	it("returns the repository for an owner", async () => {
		const repo = await getRepoWithWriteAccess(PRIVATE_REPO_ID, OWNER);
		expect(repo.id).toBe(PRIVATE_REPO_ID);
	});

	it("returns the repository for a write collaborator", async () => {
		const repo = await getRepoWithWriteAccess(PRIVATE_REPO_ID, WRITE_COLLAB);
		expect(repo.id).toBe(PRIVATE_REPO_ID);
	});

	it("throws 'Repository not found' for a missing repo", async () => {
		await expect(getRepoWithWriteAccess(999_999, OWNER)).rejects.toThrow(
			"Repository not found",
		);
	});

	it("throws 'No write access' for a read collaborator", async () => {
		await expect(
			getRepoWithWriteAccess(PRIVATE_REPO_ID, READ_COLLAB),
		).rejects.toThrow("No write access to repository");
	});

	it("throws 'No write access' for a non-collaborator", async () => {
		await expect(
			getRepoWithWriteAccess(PRIVATE_REPO_ID, OUTSIDER),
		).rejects.toThrow("No write access to repository");
	});

	it("throws 'No write access' for unauthenticated user on public repo", async () => {
		await expect(getRepoWithWriteAccess(PUBLIC_REPO_ID, null)).rejects.toThrow(
			"No write access to repository",
		);
	});
});

describe("requireReadAccess", () => {
	it("does not throw for an owner", async () => {
		await expect(
			requireReadAccess(PRIVATE_REPO_ID, OWNER),
		).resolves.toBeUndefined();
	});

	it("does not throw for a read collaborator", async () => {
		await expect(
			requireReadAccess(PRIVATE_REPO_ID, READ_COLLAB),
		).resolves.toBeUndefined();
	});

	it("throws 'Access denied' for a non-collaborator on private repo", async () => {
		await expect(requireReadAccess(PRIVATE_REPO_ID, OUTSIDER)).rejects.toThrow(
			"Access denied",
		);
	});

	it("does not throw for unauthenticated user on public repo", async () => {
		await expect(
			requireReadAccess(PUBLIC_REPO_ID, null),
		).resolves.toBeUndefined();
	});
});

describe("requireWriteAccess", () => {
	it("does not throw for an owner", async () => {
		await expect(
			requireWriteAccess(PRIVATE_REPO_ID, OWNER),
		).resolves.toBeUndefined();
	});

	it("does not throw for a write collaborator", async () => {
		await expect(
			requireWriteAccess(PRIVATE_REPO_ID, WRITE_COLLAB),
		).resolves.toBeUndefined();
	});

	it("throws 'No write access' for a read collaborator", async () => {
		await expect(
			requireWriteAccess(PRIVATE_REPO_ID, READ_COLLAB),
		).rejects.toThrow("No write access to repository");
	});

	it("throws 'No write access' for unauthenticated user on public repo", async () => {
		await expect(requireWriteAccess(PUBLIC_REPO_ID, null)).rejects.toThrow(
			"No write access to repository",
		);
	});
});
