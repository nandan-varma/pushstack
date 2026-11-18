/**
 * @vitest-environment node
 *
 * The fork server functions behind the web UI, end to end: fork from a
 * repository page, the state the button and the "forked from" line read, the
 * forks list, merge-upstream ("Sync fork") and "Open PR from fork".
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
// The fork rate limiter reads the request; a test call has no request event.
vi.mock("@tanstack/react-start/server", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getRequest: () => new Request("http://localhost/owner/app.web"),
}));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, rejectsNotFound, signIn } = await import(
	"../../test/app-harness"
);
const repositories = await import("../repositories");
const files = await import("../files");
const pullRequests = await import("../pull-requests");

const users = await createUsers("owner", "forker", "outsider");
const base64 = (text: string) => btoa(text);

let parentId: number;
let forkId: number;

beforeAll(async () => {
	signIn(users.owner);
	const parent = await repositories.createRepository({
		data: { name: "app.web" },
	});
	parentId = parent.id;
	await files.uploadFile({
		data: {
			repoId: parentId,
			branchName: "main",
			path: "README.md",
			content: base64("# app\n"),
			commitMessage: "Initial commit",
		},
	});
});

describe("forkRepository", () => {
	it("forks into the caller's account and opens the new fork", async () => {
		signIn(users.forker);
		const fork = await repositories.forkRepository({
			data: { repoId: parentId },
		});
		expect(fork).toEqual({
			name: "app.web",
			owner: { username: "forker" },
		});
		const view = await repositories.getRepositoryByName({
			data: { owner: "forker", name: "app.web" },
		});
		forkId = view.id;
		expect(view.isFork).toBe(true);
		expect(view.parent).toEqual({
			name: "app.web",
			defaultBranch: "main",
			owner: { username: "owner" },
		});
		expect(view.forksCount).toBe(0);
	});

	it("reports the fork state on the parent", async () => {
		signIn(users.forker);
		const parent = await repositories.getRepositoryByName({
			data: { owner: "owner", name: "app.web" },
		});
		expect(parent.parent).toBeUndefined();
		expect(parent.forksCount).toBe(1);
		expect(parent.viewerFork).toEqual({
			name: "app.web",
			owner: { username: "forker" },
		});
		expect(parent.viewerNameTaken).toBe(false);
	});

	it("is disabled for the owner of a repository of that name", async () => {
		signIn(users.owner);
		const parent = await repositories.getRepositoryByName({
			data: { owner: "owner", name: "app.web" },
		});
		expect(parent.viewerFork).toBeNull();
		expect(parent.viewerNameTaken).toBe(true);
	});

	it("answers the existing fork to a repeat call", async () => {
		signIn(users.forker);
		const again = await repositories.forkRepository({
			data: { repoId: parentId },
		});
		expect(again.name).toBe("app.web");
	});

	it("refuses an unreadable repository", async () => {
		signIn(users.owner);
		const privateRepo = await repositories.createRepository({
			data: { name: "secret", visibility: "private" },
		});
		signIn(users.outsider);
		expect(
			await rejectsNotFound(
				repositories.forkRepository({ data: { repoId: privateRepo.id } }),
			),
		).toBe(true);
	});
});

describe("getRepositoryForks", () => {
	it("lists the forks the viewer can read", async () => {
		signIn(users.outsider);
		const forks = await repositories.getRepositoryForks({
			data: { repoId: parentId },
		});
		expect(forks.map((fork) => fork.owner.username)).toEqual(["forker"]);
	});

	it("404s a repository the viewer cannot read", async () => {
		signIn(users.owner);
		const privateRepo = await repositories.createRepository({
			data: { name: "secret.two", visibility: "private" },
		});
		signIn(users.outsider);
		expect(
			await rejectsNotFound(
				repositories.getRepositoryForks({ data: { repoId: privateRepo.id } }),
			),
		).toBe(true);
	});
});

describe("syncFork", () => {
	it("fast-forwards the fork's branch to the parent's", async () => {
		signIn(users.owner);
		await files.uploadFile({
			data: {
				repoId: parentId,
				branchName: "main",
				path: "README.md",
				content: base64("# app\n\nupstream change\n"),
				commitMessage: "Upstream change",
			},
		});
		signIn(users.forker);
		expect(
			await repositories.syncFork({ data: { repoId: forkId, branch: "main" } }),
		).toMatchObject({ mergeType: "fast-forward" });
		const readme = await files.getFile({
			data: { repoId: forkId, branchName: "main", path: "README.md" },
		});
		expect(readme).toMatchObject({ kind: "text" });
	});

	it("reports a branch that is already up to date", async () => {
		signIn(users.forker);
		expect(
			await repositories.syncFork({ data: { repoId: forkId, branch: "main" } }),
		).toMatchObject({ mergeType: "none" });
	});

	it("refuses a repository that is not a fork", async () => {
		signIn(users.owner);
		await expect(
			repositories.syncFork({ data: { repoId: parentId, branch: "main" } }),
		).rejects.toThrow("not a fork");
	});
});

describe("createForkPullRequest", () => {
	it("opens a pull request in the parent with the fork's branch as head", async () => {
		signIn(users.forker);
		await files.createBranch({ data: { repoId: forkId, name: "feature" } });
		await files.uploadFile({
			data: {
				repoId: forkId,
				branchName: "feature",
				path: "src/a.ts",
				content: base64("export const a = 1;\n"),
				commitMessage: "Add a",
			},
		});
		const created = await pullRequests.createForkPullRequest({
			data: {
				repoId: forkId,
				title: "Add a",
				sourceBranchName: "feature",
				targetBranchName: "main",
			},
		});
		expect(created).toMatchObject({ owner: "owner", name: "app.web" });
		const list = await pullRequests.getPullRequests({
			data: { repoId: parentId },
		});
		expect(list.map((pr) => pr.title)).toContain("Add a");
	});
});
