/**
 * @vitest-environment node
 *
 * Listing endpoints must not cost one storage read per entry: sizes come from
 * batched pack reads. Pinned by counting the storage calls in the request's
 * perf tree.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const { authorNow, commitFilesToBare } = await import("git-fs-s3/ops");
const { repoFor } = await import("../git-repo");
const { afterRepositoryPush } = await import("../git-repo");
const { recentPerfTrees } = await import("../perf-log");
const users = await createUsers("alice");
const { call, mintToken, post } = await import("../../test/api-client");

const FILES = 60;

function lastStorageCalls(): number {
	const header = recentPerfTrees()[0]?.split("\n")[0] ?? "";
	const match = /r2 (\d+) calls/.exec(header);
	if (!match) throw new Error(`no perf header: ${header}`);
	return Number(match[1]);
}
describe("listing cost", () => {
	let alice: string;

	async function seed(name: string) {
		alice ??= await mintToken(users.alice, ["repo:write"]);
		await call("/user/repos", post(alice, { name }));
		await commitFilesToBare(repoFor("alice", name), {
			branch: "main",
			message: "many files",
			author: authorNow("A", "a@a.test"),
			files: Array.from({ length: FILES }, (_, i) => ({
				path: `dir/f${i}.txt`,
				content: new TextEncoder().encode(`file ${i}\n`.repeat(i + 1)),
			})),
		});
		afterRepositoryPush("alice", name);
	}

	it("lists a directory's sizes in a bounded number of storage calls", async () => {
		await seed("wide-contents");
		const dir = await call("/repos/alice/wide-contents/contents/dir");
		const calls = lastStorageCalls();
		console.log(`[storage calls] contents dir (${FILES} files): ${calls}`);
		expect(dir.body).toHaveLength(FILES);
		const f3 = dir.body.find((e: { name: string }) => e.name === "f3.txt");
		expect(f3.size).toBe("file 3\n".length * 4);
		expect(calls).toBeLessThanOrEqual(4);
	});

	it("lists a recursive tree's sizes in a bounded number of storage calls", async () => {
		await seed("wide-tree");
		const tree = await call(
			"/repos/alice/wide-tree/git/trees/main?recursive=1",
		);
		const calls = lastStorageCalls();
		console.log(`[storage calls] recursive tree (${FILES} files): ${calls}`);
		expect(tree.body.tree).toHaveLength(FILES + 1);
		expect(calls).toBeLessThanOrEqual(4);
	});
});
