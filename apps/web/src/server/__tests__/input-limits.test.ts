/**
 * @vitest-environment node
 *
 * Two invariants that are easy to lose silently, both exercised through the
 * real server functions:
 *
 * - the bounds on caller-controlled text (`src/lib/limits.ts`) are enforced by
 *   the validators, so over-large input is rejected before it is persisted;
 * - a mutation that changes who may read a repository takes effect at once, not
 *   when the access cache's TTL lapses. The cache is what makes a page load's
 *   parallel reads cheap, so this is the assertion that keeps it honest.
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

const { createUsers, rejectsNotFound, signIn, signOut } = await import(
	"../../test/app-harness"
);
const files = await import("../files");
const issues = await import("../issues");
const repositories = await import("../repositories");
const {
	MAX_BODY_CHARS,
	MAX_LIST_SKIP,
	MAX_SEARCH_QUERY_CHARS,
	MAX_WEB_UPLOAD_BYTES,
	maxBase64CharsForBytes,
} = await import("#/lib/limits");

const users = await createUsers("owner", "reader");

let repoId: number;
let repoName: string;

beforeAll(async () => {
	signIn(users.owner);
	const repo = await repositories.createRepository({
		data: { name: "limits.repo", visibility: "public" },
	});
	repoId = repo.id;
	repoName = repo.name;
});

describe("input bounds", () => {
	it("accepts an issue body at the limit and rejects one over it", async () => {
		const atLimit = await issues.createIssue({
			data: { repoId, title: "at the limit", body: "x".repeat(MAX_BODY_CHARS) },
		});
		expect(atLimit.body).toHaveLength(MAX_BODY_CHARS);

		await expect(
			issues.createIssue({
				data: {
					repoId,
					title: "over the limit",
					body: "x".repeat(MAX_BODY_CHARS + 1),
				},
			}),
		).rejects.toThrow();
	});

	it("rejects an upload whose base64 exceeds what the limit decodes to", async () => {
		// A multiple of 4 so the string is still well-formed base64: the bound
		// under test is the size, not the encoding.
		const overLimit = "A".repeat(
			maxBase64CharsForBytes(MAX_WEB_UPLOAD_BYTES) + 4,
		);
		await expect(
			files.uploadFile({
				data: {
					repoId,
					branchName: "main",
					path: "huge.bin",
					content: overLimit,
					commitMessage: "huge",
				},
			}),
		).rejects.toThrow();
	});

	it("rejects a page offset past the accepted maximum", async () => {
		// `skip` is what makes one request walk (and cache) a repository's whole
		// history, so it is bounded rather than merely non-negative.
		await expect(
			files.getCommits({
				data: { repoId, branchName: "main", skip: MAX_LIST_SKIP + 1 },
			}),
		).rejects.toThrow();
		await expect(
			issues.getIssues({
				data: { repoId, skip: MAX_LIST_SKIP + 1 },
			}),
		).rejects.toThrow();
	});

	it("rejects a search query past the accepted maximum", async () => {
		await expect(
			issues.getIssues({
				data: { repoId, query: "a".repeat(MAX_SEARCH_QUERY_CHARS + 1) },
			}),
		).rejects.toThrow();
	});

	it("rejects a username that could not name a user", async () => {
		await expect(
			repositories.addCollaboratorByUsername({
				data: { repoId, username: "not a username", role: "read" },
			}),
		).rejects.toThrow();
	});
});

describe("access changes take effect immediately", () => {
	it("stops resolving a repository as soon as a collaborator is removed", async () => {
		signIn(users.owner);
		const repo = await repositories.createRepository({
			data: { name: "revoke.reader", visibility: "private" },
		});
		await repositories.addCollaboratorByUsername({
			data: {
				repoId: repo.id,
				username: users.reader.username,
				role: "read",
			},
		});

		// Read once as the collaborator: this is what populates the access cache.
		signIn(users.reader);
		await expect(
			repositories.getRepositoryByName({
				data: { owner: users.owner.username, name: repo.name },
			}),
		).resolves.toMatchObject({ id: repo.id });

		// Revoke, then read again immediately — inside the cache's TTL, which is
		// the whole point of the assertion.
		signIn(users.owner);
		await repositories.removeCollaborator({
			data: { repoId: repo.id, userId: users.reader.id },
		});

		signIn(users.reader);
		await rejectsNotFound(
			repositories.getRepositoryByName({
				data: { owner: users.owner.username, name: repo.name },
			}),
		);
	});

	it("stops serving a repository to anonymous readers as soon as it goes private", async () => {
		signIn(users.owner);
		const repo = await repositories.createRepository({
			data: { name: "flip.visibility", visibility: "public" },
		});

		signOut();
		await expect(
			repositories.getRepositoryByName({
				data: { owner: users.owner.username, name: repo.name },
			}),
		).resolves.toMatchObject({ visibility: "public" });

		signIn(users.owner);
		await repositories.updateRepository({
			data: { id: repo.id, visibility: "private" },
		});

		signOut();
		await rejectsNotFound(
			repositories.getRepositoryByName({
				data: { owner: users.owner.username, name: repo.name },
			}),
		);
	});

	it("keeps the fixture repository readable for the rest of this file", async () => {
		signIn(users.owner);
		await expect(
			repositories.getRepositoryByName({
				data: { owner: users.owner.username, name: repoName },
			}),
		).resolves.toMatchObject({ id: repoId });
	});
});

describe("URL input that names nothing", () => {
	// A loader surfaces a validator's plain Error as a 500; on a read, input
	// that can't name anything is a 404, as on GitHub (src/server/read-input.ts).
	it("404s an unsafe commit revision, an unsafe ref or path, and an out-of-range #N", async () => {
		signOut();
		expect(
			await rejectsNotFound(files.getCommit({ data: { repoId, rev: "a..b" } })),
		).toBe(true);
		expect(
			await rejectsNotFound(
				files.getTreePageData({
					data: { repoId, branchName: "a..b", path: "" },
				}),
			),
		).toBe(true);
		expect(
			await rejectsNotFound(
				files.getFile({
					data: { repoId, branchName: "main", path: "../../x" },
				}),
			),
		).toBe(true);
		expect(
			await rejectsNotFound(
				issues.getIssueByNumber({
					data: { owner: "owner", name: repoName, number: 2 ** 40 },
				}),
			),
		).toBe(true);
	});
});
