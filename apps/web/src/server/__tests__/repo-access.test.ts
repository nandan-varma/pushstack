import { isNotFound } from "@tanstack/react-router";

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const session = vi.hoisted(() => ({
	user: null as { id: string; username: string } | null,
}));
vi.mock("../session", () => ({
	getCurrentUserOptional: async () => session.user,
	getCurrentUser: async () => {
		if (!session.user) throw new Error("Unauthorized");
		return session.user;
	},
}));

const OWNER = "repo-access-owner";
const ADMIN_COLLAB = "repo-access-admin";
const WRITE_COLLAB = "repo-access-write";
const READ_COLLAB = "repo-access-read";
const OUTSIDER = "repo-access-outsider";

let PUBLIC_REPO_ID: number;
let PRIVATE_REPO_ID: number;

beforeAll(async () => {
	const { db } = await import("../../db");
	const { user } = await import("../../db/schema");
	const { repositories, repositoryCollaborators } = await import(
		"../../db/app-schema"
	);

	for (const id of [OWNER, ADMIN_COLLAB, WRITE_COLLAB, READ_COLLAB, OUTSIDER]) {
		await db.insert(user).values({
			id,
			username: id,
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
	readWithAccess,
	requireOwner,
	requireWriteAccess,
	writeWithAccess,
} = await import("../repo-access");

const { db } = await import("../../db");

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
			where: {
				RAW: (repos, { eq }) => eq(repos.id, PRIVATE_REPO_ID),
			},
		});
		if (!repo) throw new Error("repo not found");

		const access = await getAccessForRepository(repo, OWNER);
		expect(access.role).toBe("owner");
		expect(access.canWrite).toBe(true);
	});

	it("returns owner access without querying collaborators when userId matches ownerId", async () => {
		const repo = await db.query.repositories.findFirst({
			where: {
				RAW: (repos, { eq }) => eq(repos.id, PRIVATE_REPO_ID),
			},
		});
		if (!repo) throw new Error("repo not found");

		const access = await getAccessForRepository(repo, OWNER);
		expect(access.role).toBe("owner");
		expect(access.role).toBe("owner");
	});

	it("queries collaborators for non-owner userId", async () => {
		const repo = await db.query.repositories.findFirst({
			where: {
				RAW: (repos, { eq }) => eq(repos.id, PRIVATE_REPO_ID),
			},
		});
		if (!repo) throw new Error("repo not found");

		const access = await getAccessForRepository(repo, WRITE_COLLAB);
		expect(access.role).toBe("write");
		expect(access.role).toBe("write");
	});

	it("returns anonymous for null userId on private repo", async () => {
		const repo = await db.query.repositories.findFirst({
			where: {
				RAW: (repos, { eq }) => eq(repos.id, PRIVATE_REPO_ID),
			},
		});
		if (!repo) throw new Error("repo not found");

		const access = await getAccessForRepository(repo, null);
		expect(access.role).toBe("anonymous");
		expect(access.canRead).toBe(false);
	});

	it("returns anonymous read for null userId on public repo", async () => {
		const repo = await db.query.repositories.findFirst({
			where: {
				RAW: (repos, { eq }) => eq(repos.id, PUBLIC_REPO_ID),
			},
		});
		if (!repo) throw new Error("repo not found");

		const access = await getAccessForRepository(repo, null);
		expect(access.role).toBe("anonymous");
		expect(access.canRead).toBe(true);
	});
});

describe("readWithAccess", () => {
	it("hands the repository, owner loaded, to a caller who can read it", async () => {
		session.user = { id: READ_COLLAB, username: READ_COLLAB };
		const repo = await readWithAccess("t", PRIVATE_REPO_ID, async (r) => r);
		expect(repo.owner.username).toBe(OWNER);
	});

	it("answers notFound() for a missing repo or one the caller can't read", async () => {
		session.user = { id: OUTSIDER, username: OUTSIDER };
		await expect(
			readWithAccess("t", PRIVATE_REPO_ID, async () => 1),
		).rejects.toSatisfy(isNotFound);
		await expect(readWithAccess("t", 999_999, async () => 1)).rejects.toSatisfy(
			isNotFound,
		);
	});

	it("lets anonymous visitors read public repositories", async () => {
		session.user = null;
		await expect(
			readWithAccess("t", PUBLIC_REPO_ID, async () => "ok"),
		).resolves.toBe("ok");
	});

	it("turns a git not-found inside the read into a 404", async () => {
		session.user = { id: OWNER, username: OWNER };
		const { GitRefNotFoundError } = await import("git-fs-s3");
		await expect(
			readWithAccess("t", PUBLIC_REPO_ID, async () => {
				throw new GitRefNotFoundError("gone");
			}),
		).rejects.toSatisfy(isNotFound);
	});
});

describe("writeWithAccess / requireWriteAccess / requireOwner", () => {
	it("admits owners and write collaborators", async () => {
		for (const id of [OWNER, WRITE_COLLAB]) {
			session.user = { id, username: id };
			await expect(
				writeWithAccess(PRIVATE_REPO_ID, async (r, u) => [r.id, u.id]),
			).resolves.toEqual([PRIVATE_REPO_ID, id]);
			await expect(
				requireWriteAccess(PRIVATE_REPO_ID, id),
			).resolves.toBeUndefined();
		}
	});

	it("refuses read collaborators and anonymous callers", async () => {
		session.user = { id: READ_COLLAB, username: READ_COLLAB };
		await expect(
			writeWithAccess(PRIVATE_REPO_ID, async () => 1),
		).rejects.toThrow("No write access");
		session.user = null;
		await expect(
			writeWithAccess(PUBLIC_REPO_ID, async () => 1),
		).rejects.toThrow("Unauthorized");
	});

	it("requireOwner admits only the owner", async () => {
		await expect(
			requireOwner(PRIVATE_REPO_ID, OWNER, "nope"),
		).resolves.toMatchObject({ id: PRIVATE_REPO_ID });
		await expect(
			requireOwner(PRIVATE_REPO_ID, ADMIN_COLLAB, "nope"),
		).rejects.toThrow("nope");
	});
});
