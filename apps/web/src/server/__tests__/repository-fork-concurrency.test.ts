/**
 * @vitest-environment node
 *
 * Duplicate and interrupted fork requests must never answer an empty fork.
 * A row exists only once its copy has committed, so these tests pin: a
 * duplicate that arrives mid-copy waits and then answers the complete fork; a
 * copy that failed under a waiting duplicate does not leak into its answer;
 * and storage a killed copy left behind (no row) is cleared by the next attempt.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
	/** While set, a copy waits on this before it starts. */
	hold: null as Promise<void> | null,
	/** Called when a held copy has started waiting. */
	entered: null as (() => void) | null,
	/** The next copy throws instead of copying. */
	failNext: false,
}));

vi.mock("git-fs-s3", async (importOriginal) => {
	const actual = await importOriginal<typeof import("git-fs-s3")>();
	return {
		...actual,
		copyPrefix: async (
			...args: Parameters<typeof actual.copyPrefix>
		): Promise<number> => {
			if (gate.hold) {
				gate.entered?.();
				await gate.hold;
			}
			if (gate.failNext) {
				gate.failNext = false;
				throw new Error("injected copy failure");
			}
			return actual.copyPrefix(...args);
		},
	};
});

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const users = await createUsers("forker", "parentowner");
const { db } = await import("#/db");
const { createCommit } = await import("../git-write");
const { listRepoStorage, putStorageObject } = await import("../git-fs");
const { createRepositoryForUser } = await import("../repository-create");
const { forkRepositoryForUser } = await import("../repository-fork");

const parentOwner = { id: "parentowner-id", username: "parentowner" };

async function parentNamed(name: string) {
	const row = await createRepositoryForUser(users.parentowner, {
		name,
		visibility: "public",
		autoInit: false,
	});
	await createCommit("parentowner", name, {
		branch: "main",
		message: "root",
		files: [
			{ path: "README.md", content: "hello\n" },
			{ path: "src/a.txt", content: "a\n" },
		],
		author: { name: "Parent", email: "parentowner@example.com" },
	});
	return { ...row, owner: parentOwner };
}

function forkRow(name: string) {
	return db.query.repositories.findFirst({
		where: { ownerId: users.forker.id, name },
	});
}

/** Holds the next copy until `release()`; resolves `entered` once it is waiting. */
function holdNextCopy() {
	let release!: () => void;
	gate.hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	const entered = new Promise<void>((resolve) => {
		gate.entered = resolve;
	});
	return {
		entered,
		release: () => {
			gate.hold = null;
			gate.entered = null;
			release();
		},
	};
}

const settled = (promise: Promise<unknown>) => {
	const state = { done: false };
	promise.then(
		() => {
			state.done = true;
		},
		() => {
			state.done = true;
		},
	);
	return state;
};

const pause = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeAll(async () => {
	await parentNamed("shared");
});

describe("duplicate and interrupted forks", () => {
	it("a duplicate that arrives mid-copy waits, then answers the complete fork", async () => {
		const parent = await db.query.repositories.findFirst({
			where: { name: "shared" },
			with: { owner: { columns: { id: true, username: true } } },
		});
		if (!parent) throw new Error("no parent");
		const parentKeys = (await listRepoStorage("parentowner", "shared")).length;

		const hold = holdNextCopy();
		const first = forkRepositoryForUser(parent, users.forker, "dup");
		await hold.entered;

		const second = forkRepositoryForUser(parent, users.forker, "dup");
		const secondState = settled(second);
		await pause();
		expect(secondState.done).toBe(false);
		expect(await forkRow("dup")).toBeUndefined();

		hold.release();
		const [a, b] = await Promise.all([first, second]);
		expect(b.id).toBe(a.id);
		expect(a).toMatchObject({ isFork: true, forkOfId: parent.id });
		expect((await listRepoStorage("forker", "dup")).length).toBe(parentKeys);
	});

	it("a duplicate after a copy that failed under it makes its own complete fork", async () => {
		const parent = await db.query.repositories.findFirst({
			where: { name: "shared" },
			with: { owner: { columns: { id: true, username: true } } },
		});
		if (!parent) throw new Error("no parent");
		const parentKeys = (await listRepoStorage("parentowner", "shared")).length;

		const hold = holdNextCopy();
		gate.failNext = true;
		const first = forkRepositoryForUser(parent, users.forker, "flaky-dup");
		await hold.entered;
		const second = forkRepositoryForUser(parent, users.forker, "flaky-dup");
		hold.release();

		await expect(first).rejects.toThrow("injected copy failure");
		const retried = await second;
		expect(retried).toMatchObject({ isFork: true, forkOfId: parent.id });
		expect((await listRepoStorage("forker", "flaky-dup")).length).toBe(
			parentKeys,
		);
	});

	it("a repeat after a killed copy (storage, no row) clears it and copies in full", async () => {
		const parent = await db.query.repositories.findFirst({
			where: { name: "shared" },
			with: { owner: { columns: { id: true, username: true } } },
		});
		if (!parent) throw new Error("no parent");
		const parentKeys = (await listRepoStorage("parentowner", "shared")).length;

		// What a copy killed by a timeout leaves: part of the prefix, no row.
		await putStorageObject(
			"repos/forker/killed/git/objects/pack/partial.pack",
			new Uint8Array([1, 2, 3]),
		);
		await putStorageObject(
			"repos/forker/killed/git/HEAD",
			new TextEncoder().encode("ref: refs/heads/stale\n"),
		);
		expect(await forkRow("killed")).toBeUndefined();

		const fork = await forkRepositoryForUser(parent, users.forker, "killed");
		expect(fork).toMatchObject({ isFork: true, forkOfId: parent.id });
		const keys = (await listRepoStorage("forker", "killed")).map((o) => o.key);
		expect(keys).toHaveLength(parentKeys);
		expect(keys).not.toContain(
			"repos/forker/killed/git/objects/pack/partial.pack",
		);
	});
});
