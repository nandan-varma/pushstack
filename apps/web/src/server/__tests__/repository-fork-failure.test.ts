/**
 * @vitest-environment node
 *
 * A fork that cannot be made leaves nothing behind: no row, no storage under
 * the fork's name, and the parent untouched. Covers the size cap (refused
 * before any byte is copied) and a copy that fails partway through.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const limit = vi.hoisted(() => ({ bytes: 1024 ** 3 }));
const failing = vi.hoisted(() => ({ afterCopies: 0 }));

vi.mock("#/lib/limits", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/limits")>();
	return {
		...actual,
		get MAX_FORK_COPY_BYTES() {
			return limit.bytes;
		},
	};
});

vi.mock("git-fs-s3", async (importOriginal) => {
	const actual = await importOriginal<typeof import("git-fs-s3")>();
	return {
		...actual,
		copyPrefix: (
			store: Parameters<typeof actual.copyPrefix>[0],
			from: string,
			to: string,
			options: Parameters<typeof actual.copyPrefix>[3] = {},
		) => {
			if (failing.afterCopies === 0) {
				return actual.copyPrefix(store, from, to, options);
			}
			let copies = 0;
			const copy =
				options.copy ??
				(async (fromKey: string, toKey: string) => {
					const data = await store.get(fromKey);
					if (data) await store.put(toKey, data);
				});
			return actual.copyPrefix(store, from, to, {
				...options,
				copy: async (fromKey, toKey) => {
					if (copies++ >= failing.afterCopies) {
						throw new Error("injected copy failure");
					}
					await copy(fromKey, toKey);
				},
			});
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
const { listRepoStorage } = await import("../git-fs");
const { createRepositoryForUser } = await import("../repository-create");
const { ForkTooLargeError, forkRepositoryForUser } = await import(
	"../repository-fork"
);

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
		files: [{ path: "README.md", content: "hello\n" }],
		author: { name: "Parent", email: "parentowner@example.com" },
	});
	return { ...row, owner: parentOwner };
}

async function forkRowNamed(name: string) {
	return db.query.repositories.findFirst({
		where: { ownerId: users.forker.id, name },
	});
}

beforeAll(() => {
	failing.afterCopies = 0;
});

describe("a fork that cannot be made", () => {
	it("refuses a parent over the byte cap before copying anything", async () => {
		const parent = await parentNamed("capped");
		const before = (await listRepoStorage("parentowner", "capped")).length;
		limit.bytes = 1;
		try {
			await expect(
				forkRepositoryForUser(parent, users.forker, "capped-fork"),
			).rejects.toBeInstanceOf(ForkTooLargeError);
		} finally {
			limit.bytes = 1024 ** 3;
		}
		expect(await forkRowNamed("capped-fork")).toBeUndefined();
		expect(await listRepoStorage("forker", "capped-fork")).toEqual([]);
		expect(await listRepoStorage("parentowner", "capped")).toHaveLength(before);
	});

	it("leaves no row and no storage when a copy fails partway, and the parent intact", async () => {
		const parent = await parentNamed("flaky");
		const before = (await listRepoStorage("parentowner", "flaky")).length;
		expect(before).toBeGreaterThan(1);
		failing.afterCopies = 1;
		try {
			await expect(
				forkRepositoryForUser(parent, users.forker, "flaky-fork"),
			).rejects.toThrow("injected copy failure");
		} finally {
			failing.afterCopies = 0;
		}
		expect(await forkRowNamed("flaky-fork")).toBeUndefined();
		expect(await listRepoStorage("forker", "flaky-fork")).toEqual([]);
		expect(await listRepoStorage("parentowner", "flaky")).toHaveLength(before);
	});

	it("can be retried under the same name after a failure", async () => {
		const parent = await parentNamed("retry");
		failing.afterCopies = 1;
		try {
			await expect(
				forkRepositoryForUser(parent, users.forker, "retry-fork"),
			).rejects.toThrow();
		} finally {
			failing.afterCopies = 0;
		}
		const fork = await forkRepositoryForUser(
			parent,
			users.forker,
			"retry-fork",
		);
		expect(fork).toMatchObject({ isFork: true, forkOfId: parent.id });
		expect(
			(await listRepoStorage("forker", "retry-fork")).length,
		).toBeGreaterThan(1);
	});
});
