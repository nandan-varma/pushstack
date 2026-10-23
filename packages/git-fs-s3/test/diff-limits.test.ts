import git from "isomorphic-git";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as blobContent from "../src/edge-utils.js";
import { createGitFs, MemoryObjectStore } from "../src/index.js";
import * as objectSize from "../src/object-size.js";
import {
	authorNow,
	commitFilesToBare,
	DiffLimitError,
	getCommitDiff,
	getDiffBetweenRefs,
	MAX_DIFF_FILES,
	type Repo,
} from "../src/ops/index.js";

const author = authorNow("Test", "test@example.com");
async function seed(files: { path: string; content: string }[]) {
	const repo: Repo = {
		fs: createGitFs(new MemoryObjectStore()),
		gitdir: "git",
		cache: {},
	};
	await git.init({
		...repo,
		dir: repo.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	const oid = await commitFilesToBare(repo, {
		branch: "main",
		message: "root",
		author,
		files,
	});
	return { repo, oid };
}
afterEach(() => vi.restoreAllMocks());

describe("diff work budgets", () => {
	it("refuses too many changed files before reading their blobs", async () => {
		const { repo, oid } = await seed(
			Array.from({ length: 20 }, (_, i) => ({
				path: `file-${i}`,
				content: "body",
			})),
		);
		const reads = vi.spyOn(git, "readBlob");
		await expect(
			getCommitDiff(repo, oid, { maxFiles: 2 }),
		).rejects.toMatchObject({
			name: "DiffLimitError",
			metric: "files",
			limit: 2,
			statusCode: 406,
		});
		expect(reads).not.toHaveBeenCalled();
	});
	it("reserves packed blob input bytes before inflating or formatting", async () => {
		const { repo, oid } = await seed([{ path: "file", content: "12345678" }]);
		const reads = vi.spyOn(git, "readBlob");
		await expect(
			getCommitDiff(repo, oid, { maxBytes: 7 }),
		).rejects.toBeInstanceOf(DiffLimitError);
		expect(reads).not.toHaveBeenCalled();
	});
	it("charges unknown sizes before decoding or formatting", async () => {
		const { repo, oid } = await seed([{ path: "file", content: "12345678" }]);
		vi.spyOn(objectSize, "getObjectSize").mockResolvedValue(null);
		const format = vi.spyOn(blobContent, "readBlobContent");
		await expect(
			getCommitDiff(repo, oid, { maxBytes: 7 }),
		).rejects.toMatchObject({ metric: "bytes", limit: 7 });
		expect(format).not.toHaveBeenCalled();
	});
	it("counts binary files and gitlinks toward the file budget", async () => {
		const { repo } = await seed([{ path: "binary", content: "a\0b" }]);
		const blob = await git.writeBlob({
			...repo,
			blob: new TextEncoder().encode("a\0b"),
		});
		const tree = await git.writeTree({
			...repo,
			tree: [
				{ path: "binary", mode: "100644", type: "blob", oid: blob },
				{ path: "module", mode: "160000", type: "commit", oid: "1".repeat(40) },
			],
		});
		const oid = await git.writeCommit({
			...repo,
			commit: { message: "root", tree, parent: [], author, committer: author },
		});
		await expect(
			getCommitDiff(repo, oid, { maxFiles: 1 }),
		).rejects.toMatchObject({ metric: "files" });
		expect(
			(await getCommitDiff(repo, oid, { maxFiles: 2 })).files.map(
				(f) => f.kind,
			),
		).toEqual(["binary", "submodule"]);
	});

	it("counts both sides of a modification", async () => {
		const { repo } = await seed([{ path: "file", content: "12345678" }]);
		const oid = await commitFilesToBare(repo, {
			branch: "main",
			message: "modify",
			author,
			files: [{ path: "file", content: "abcdefgh" }],
		});
		const reads = vi.spyOn(git, "readBlob");
		await expect(
			getCommitDiff(repo, oid, { maxBytes: 15 }),
		).rejects.toMatchObject({ metric: "bytes", limit: 15 });
		expect(reads).not.toHaveBeenCalled();
	});
	it("also caps UTF-8 patch bytes, including headers and paths", async () => {
		const { repo, oid } = await seed([{ path: "目录/文件.txt", content: "a" }]);
		await expect(
			getCommitDiff(repo, oid, { maxBytes: 20 }),
		).rejects.toMatchObject({ metric: "bytes", limit: 20 });
	});
	it("accepts an exact file and patch-byte boundary", async () => {
		const { repo, oid } = await seed([{ path: "file", content: "a" }]);
		const expected = await getCommitDiff(repo, oid);
		const bytes = new TextEncoder().encode(expected.files[0]?.patch).byteLength;
		expect(
			await getCommitDiff(repo, oid, { maxFiles: 1, maxBytes: bytes }),
		).toEqual(expected);
		await expect(
			getCommitDiff(repo, oid, { maxBytes: bytes - 1 }),
		).rejects.toMatchObject({ metric: "bytes" });
	});
	it("applies to three-dot comparisons and leaves an empty diff distinct", async () => {
		const { repo } = await seed([{ path: "file", content: "a" }]);
		const base = await git.resolveRef({ ...repo, ref: "main" });
		await commitFilesToBare(repo, {
			branch: "main",
			message: "next",
			author,
			files: [{ path: "file", content: "b" }],
		});
		await expect(
			getDiffBetweenRefs(repo, base, "main", { maxFiles: 0 }),
		).rejects.toBeInstanceOf(DiffLimitError);
		expect(
			(
				await getDiffBetweenRefs(repo, "main", "main", {
					maxFiles: 0,
					maxBytes: 0,
				})
			).files,
		).toEqual([]);
	});
	it("bounds default calls without requiring every caller to opt in", async () => {
		const { repo, oid } = await seed(
			Array.from({ length: MAX_DIFF_FILES + 1 }, (_, i) => ({
				path: `file-${i}`,
				content: "",
			})),
		);
		await expect(getCommitDiff(repo, oid)).rejects.toMatchObject({
			metric: "files",
			limit: MAX_DIFF_FILES,
		});
		// Inherently heavy: only committing MAX_DIFF_FILES + 1 files crosses the
		// default budget (about 3.7s idle, past 5s under a full parallel run).
	}, 30_000);
	it.each([-1, NaN, Infinity, 0.5])(
		"rejects invalid work limits %s",
		async (maxFiles) => {
			const { repo, oid } = await seed([{ path: "file", content: "a" }]);
			await expect(
				getCommitDiff(repo, oid, { maxFiles }),
			).rejects.toBeInstanceOf(RangeError);
		},
	);
});
