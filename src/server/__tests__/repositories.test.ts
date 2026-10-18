/**
 * @vitest-environment node
 *
 * Repository and file server functions, end to end: real Postgres (pglite),
 * real git over git-fs.ts's in-memory store; only the session is faked.
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
const repositories = await import("../repositories");
const files = await import("../files");
const { getUserActivity } = await import("../search");

const users = await createUsers("owner", "writer", "reader", "outsider");
const base64 = (text: string) => btoa(text);

let repoId: number;

beforeAll(async () => {
	signIn(users.owner);
	const repo = await repositories.createRepository({
		data: { name: "app.web", visibility: "private" },
	});
	repoId = repo.id;
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "writer", role: "write" },
	});
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "reader", role: "read" },
	});
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "README.md",
			content: base64("# app\n"),
			commitMessage: "Initial commit",
		},
	});
});

describe("createRepository", () => {
	it("rejects a duplicate name", async () => {
		signIn(users.owner);
		await expect(
			repositories.createRepository({ data: { name: "app.web" } }),
		).rejects.toThrow("already exists");
	});

	it.each([[".."], ["."], ["a/b"], ["a\\b"], [""], ["-x"], ["x-"]])(
		"rejects the unsafe name %j",
		async (name) => {
			signIn(users.owner);
			await expect(
				repositories.createRepository({ data: { name } }),
			).rejects.toThrow();
		},
	);

	it("records a create_repo activity", async () => {
		signIn(users.owner);
		const feed = await getUserActivity({ data: {} });
		expect(feed.some((a) => a.type === "create_repo")).toBe(true);
	});
});

describe("getRepositoryByName", () => {
	it("answers a private repository like a missing one to outsiders", async () => {
		signIn(users.outsider);
		expect(
			await rejectsNotFound(
				repositories.getRepositoryByName({
					data: { owner: "owner", name: "app.web" },
				}),
			),
		).toBe(true);
		signOut();
		expect(
			await rejectsNotFound(
				repositories.getRepositoryByName({
					data: { owner: "owner", name: "app.web" },
				}),
			),
		).toBe(true);
	});

	it("never exposes the owner's email", async () => {
		signIn(users.reader);
		const repo = await repositories.getRepositoryByName({
			data: { owner: "owner", name: "app.web" },
		});
		expect(repo.owner.username).toBe("owner");
		expect(JSON.stringify(repo)).not.toContain("@example.com");
	});
});

describe("stars", () => {
	it("toggles, counting each user once", async () => {
		signIn(users.reader);
		expect(await repositories.toggleStar({ data: { repoId } })).toEqual({
			starred: true,
		});
		const starred = await repositories.getRepositoryByName({
			data: { owner: "owner", name: "app.web" },
		});
		expect(starred).toMatchObject({ starCount: 1, isStarred: true });
		expect(await repositories.toggleStar({ data: { repoId } })).toEqual({
			starred: false,
		});
	});

	it("can't star what you can't read", async () => {
		signIn(users.outsider);
		expect(
			await rejectsNotFound(repositories.toggleStar({ data: { repoId } })),
		).toBe(true);
	});
});

describe("collaborators", () => {
	it("re-adding updates the role instead of duplicating", async () => {
		signIn(users.owner);
		await repositories.addCollaboratorByUsername({
			data: { repoId, username: "reader", role: "read" },
		});
		const list = await repositories.getCollaborators({ data: { repoId } });
		expect(list.filter((c) => c.user.username === "reader")).toHaveLength(1);
		expect(JSON.stringify(list)).not.toContain("@example.com");
	});

	it("only the owner manages collaborators", async () => {
		signIn(users.writer);
		await expect(
			repositories.addCollaboratorByUsername({
				data: { repoId, username: "outsider" },
			}),
		).rejects.toThrow("Only the repository owner");
	});
});

describe("files", () => {
	it("serves a committed file to readers, with its history", async () => {
		signIn(users.reader);
		const view = await files.getFile({
			data: { repoId, branchName: "main", path: "README.md" },
		});
		expect(view).toEqual({ kind: "text", size: 6, content: "# app\n" });
		const history = await files.getFileHistory({
			data: { repoId, branchName: "main", path: "README.md", depth: "banner" },
		});
		expect(history.entries[0]?.message).toBe("Initial commit");
	});

	it("lets write collaborators commit and branch, but not readers", async () => {
		signIn(users.writer);
		await files.createBranch({ data: { repoId, name: "feature/x" } });
		await files.uploadFile({
			data: {
				repoId,
				branchName: "feature/x",
				path: "src/a.ts",
				content: base64("export {};\n"),
				commitMessage: "Add a",
			},
		});
		const branches = await files.getBranches({ data: { repoId } });
		expect(branches.map((b) => b.name).sort()).toEqual(["feature/x", "main"]);

		signIn(users.reader);
		await expect(
			files.uploadFile({
				data: {
					repoId,
					branchName: "main",
					path: "x.txt",
					content: base64("x"),
					commitMessage: "x",
				},
			}),
		).rejects.toThrow("No write access");
	});

	it.each([["../escape"], [".git/config"], ["/abs"]])(
		"rejects the unsafe path %j before touching git",
		async (path) => {
			signIn(users.owner);
			await expect(
				files.uploadFile({
					data: {
						repoId,
						branchName: "main",
						path,
						content: base64("x"),
						commitMessage: "x",
					},
				}),
			).rejects.toThrow();
		},
	);

	it("rejects a path-traversal branch name", async () => {
		signIn(users.owner);
		await expect(
			files.createBranch({
				data: { repoId, name: "../../other/repo/git/refs/heads/main" },
			}),
		).rejects.toThrow();
	});

	it("refuses to delete the default branch", async () => {
		signIn(users.owner);
		await expect(
			files.deleteBranch({ data: { repoId, name: "main" } }),
		).rejects.toThrow("default branch");
	});

	it("diffs a branch against where it left main (three-dot)", async () => {
		signIn(users.reader);
		const diff = await files.getBranchDiff({
			data: { repoId, sourceBranch: "feature/x", targetBranch: "main" },
		});
		expect(diff.files.map((f) => f.path)).toEqual(["src/a.ts"]);
	});

	it("deletes a file with a commit, and 404s a missing one", async () => {
		signIn(users.owner);
		await files.deleteFile({
			data: {
				repoId,
				branchName: "feature/x",
				path: "src/a.ts",
				commitMessage: "Remove a",
			},
		});
		expect(
			await rejectsNotFound(
				files.getFile({
					data: { repoId, branchName: "feature/x", path: "src/a.ts" },
				}),
			),
		).toBe(true);
	});
});

describe("updateRepository", () => {
	it("renames the repository and moves its storage along", async () => {
		signIn(users.owner);
		await repositories.updateRepository({
			data: { id: repoId, name: "app.renamed" },
		});
		const view = await files.getFile({
			data: { repoId, branchName: "main", path: "README.md" },
		});
		expect(view.kind).toBe("text");
		expect(
			await rejectsNotFound(
				repositories.getRepositoryByName({
					data: { owner: "owner", name: "app.web" },
				}),
			),
		).toBe(true);
	});

	it("changes the default branch only to an existing branch", async () => {
		signIn(users.owner);
		await expect(
			repositories.updateRepository({
				data: { id: repoId, defaultBranch: "nope" },
			}),
		).rejects.toThrow();
	});

	it("is owner-only", async () => {
		signIn(users.writer);
		await expect(
			repositories.updateRepository({ data: { id: repoId, description: "x" } }),
		).rejects.toThrow("Only the repository owner");
	});
});

describe("deleteRepository", () => {
	it("removes the repository; a new one with its name starts empty", async () => {
		signIn(users.owner);
		await repositories.deleteRepository({ data: { id: repoId } });
		const fresh = await repositories.createRepository({
			data: { name: "app.renamed" },
		});
		const branches = await files.getBranches({ data: { repoId: fresh.id } });
		expect(branches).toEqual([]);
	});
});
