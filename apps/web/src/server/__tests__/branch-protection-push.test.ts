/**
 * @vitest-environment node
 *
 * Push enforcement: a protected branch refuses a force push and a deletion
 * with GitHub's GH006 messages, unless the rule allows that operation or an
 * owner/admin bypasses it (`enforce_admins` off).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { db } = await import("../../db");
const { branchProtectionRules } = await import("../../db/app-schema");
const { vetPush } = await import("../branch-protection");
const { repoFor } = await import("../git-repo");
const { createBranch, createCommit } = await import("../git-write");
const { createRepository, addCollaboratorByUsername } = await import(
	"../repositories"
);
const { findRepositoryByName } = await import("../repository-lookup");

const REPO = "guard";
const ZERO = "0".repeat(40);
const toe = { name: "Alice", email: "alice@example.com" };

let repository: NonNullable<Awaited<ReturnType<typeof findRepositoryByName>>>;
let first: string;
let second: string;
let diverged: string;

const update = (oldOid: string, newOid: string) => [
	{ oldOid, newOid, refName: "refs/heads/main" },
];

async function setRule(values: Record<string, unknown>): Promise<void> {
	await db.delete(branchProtectionRules);
	await db
		.insert(branchProtectionRules)
		.values({ repoId: repository.id, pattern: "main", ...values });
}

beforeAll(async () => {
	signIn(users.alice);
	await createRepository({ data: { name: REPO, visibility: "private" } });
	const created = await findRepositoryByName("alice", REPO);
	if (!created) throw new Error("fixture repository missing");
	repository = created;
	first = await createCommit("alice", REPO, {
		branch: "main",
		message: "first",
		files: [{ path: "one.txt", content: "1\n" }],
		author: toe,
	});
	await createBranch("alice", REPO, "diverged", "main");
	diverged = await createCommit("alice", REPO, {
		branch: "diverged",
		message: "diverged",
		files: [{ path: "diverged.txt", content: "d\n" }],
		author: toe,
	});
	second = await createCommit("alice", REPO, {
		branch: "main",
		message: "second",
		files: [{ path: "two.txt", content: "2\n" }],
		author: toe,
	});
	await addCollaboratorByUsername({
		data: { repoId: repository.id, username: "bob", role: "write" },
	});
});

describe("vetPush", () => {
	it("refuses a force push with GitHub's GH006 lines", async () => {
		await setRule({ requiresPullRequest: true });
		const vetoes = await vetPush(
			repository,
			users.bob.id,
			update(second, diverged),
			repoFor("alice", REPO),
		);
		expect(vetoes).toHaveLength(1);
		expect(vetoes[0].refName).toBe("refs/heads/main");
		expect(vetoes[0].reason).toBe("protected branch hook declined");
		expect(vetoes[0].messages).toEqual([
			"error: GH006: Protected branch update failed for refs/heads/main.",
			"error: Cannot force-push to a protected branch.",
		]);
	});

	it("accepts a fast-forward and a new branch", async () => {
		await setRule({ requiresPullRequest: true });
		expect(
			await vetPush(
				repository,
				users.alice.id,
				update(first, second),
				repoFor("alice", REPO),
			),
		).toEqual([]);
		expect(
			await vetPush(
				repository,
				users.alice.id,
				[{ oldOid: ZERO, newOid: diverged, refName: "refs/heads/feature" }],
				repoFor("alice", REPO),
			),
		).toEqual([]);
	});

	it("refuses deleting a protected branch", async () => {
		await setRule({ requiresPullRequest: true });
		const vetoes = await vetPush(
			repository,
			users.bob.id,
			update(second, ZERO),
			repoFor("alice", REPO),
		);
		expect(vetoes[0].messages).toEqual([
			"error: GH006: Protected branch update failed for refs/heads/main.",
			"error: Cannot delete a protected branch.",
		]);
	});

	it("allows force pushes and deletions the rule enables", async () => {
		await setRule({ allowForcePushes: true, allowDeletions: true });
		const repo = repoFor("alice", REPO);
		expect(
			await vetPush(repository, users.bob.id, update(second, diverged), repo),
		).toEqual([]);
		expect(
			await vetPush(repository, users.bob.id, update(second, ZERO), repo),
		).toEqual([]);
	});

	it("blocks a writer even when admins bypass, and lets the owner bypass", async () => {
		await setRule({ requiresPullRequest: true, enforceAdmins: false });
		const repo = repoFor("alice", REPO);
		expect(
			await vetPush(repository, users.bob.id, update(second, diverged), repo),
		).toHaveLength(1);
		expect(
			await vetPush(repository, users.alice.id, update(second, diverged), repo),
		).toEqual([]);
	});

	it("enforces the rule on the owner when admins may not bypass", async () => {
		await setRule({ requiresPullRequest: true, enforceAdmins: true });
		expect(
			await vetPush(
				repository,
				users.alice.id,
				update(second, diverged),
				repoFor("alice", REPO),
			),
		).toHaveLength(1);
	});
});
