import { createTwoFilesPatch } from "diff";
import git from "isomorphic-git";
import { getCommit } from "./git-history-ops";
import { getRepoOptions, qualifyBranchRef } from "./git-repo-storage";

export interface DiffFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
	additions: number;
	deletions: number;
	patch: string;
	oldPath?: string;
	isBinary?: boolean;
	oldContent?: string;
	newContent?: string;
	oldSize?: number;
	newSize?: number;
}

export interface DiffResult {
	files: DiffFile[];
	totalAdditions: number;
	totalDeletions: number;
	totalFiles: number;
}

/** Same null-byte heuristic as getFileFromBranch in git-history-ops.ts. */
function readBlobContent(blob: Uint8Array): {
	buffer: Buffer;
	isBinary: boolean;
	text: string;
} {
	const buffer = Buffer.from(blob);
	const isBinary = buffer.includes(0);
	return { buffer, isBinary, text: isBinary ? "" : buffer.toString() };
}

function countContentLines(content: string): number {
	if (content.length === 0) return 0;
	const lines = content.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines.length;
}

function createUnifiedPatch(params: {
	path: string;
	before: string;
	after: string;
	oldPath?: string;
	newPath?: string;
}): string {
	const oldPath = params.oldPath ?? `a/${params.path}`;
	const newPath = params.newPath ?? `b/${params.path}`;
	const patchBody = createTwoFilesPatch(
		oldPath,
		newPath,
		params.before,
		params.after,
		"",
		"",
		{ context: 3 },
	).replace(/^=+\n/, "");

	return `diff --git a/${params.path} b/${params.path}\n${patchBody}`;
}

export async function getCommitDiff(
	ownerKey: string,
	repoName: string,
	commitSha: string,
): Promise<DiffResult> {
	const repo = await getRepoOptions(ownerKey, repoName);

	try {
		const commit = await getCommit(ownerKey, repoName, commitSha);
		const parent = commit.commit.parent[0];

		if (!parent) {
			const tree = await git.readTree({ ...repo, oid: commit.commit.tree });

			// ponytail: previously called getFileContent per entry, which redundantly
			// re-resolved the commit and re-walked the tree from root for every single
			// file even though `entry.oid` already points straight at the blob — and
			// did it one file at a time. Read blobs directly, in parallel.
			const files: DiffFile[] = await Promise.all(
				tree.tree
					.filter((entry) => entry.type === "blob")
					.map(async (entry) => {
						const { blob } = await git.readBlob({ ...repo, oid: entry.oid });
						const after = readBlobContent(blob);
						return {
							path: entry.path,
							status: "added" as const,
							additions: after.isBinary ? 0 : countContentLines(after.text),
							deletions: 0,
							patch: after.isBinary
								? ""
								: createUnifiedPatch({
										path: entry.path,
										before: "",
										after: after.text,
										oldPath: "/dev/null",
									}),
							isBinary: after.isBinary,
							newContent: after.isBinary
								? after.buffer.toString("base64")
								: undefined,
							newSize: after.buffer.length,
						};
					}),
			);

			return {
				files,
				totalAdditions: files.reduce(
					(sum: number, f: DiffFile) => sum + f.additions,
					0,
				),
				totalDeletions: 0,
				totalFiles: files.length,
			};
		}

		const changes = await git.walk({
			...repo,
			trees: [git.TREE({ ref: parent }), git.TREE({ ref: commitSha })],
			map: async (filepath, [A, B]) => {
				const [typeA, typeB] = await Promise.all([A?.type(), B?.type()]);

				if (typeA === "tree" || typeB === "tree") return;

				if (typeA && !typeB) {
					const oidA = A ? await A.oid() : "";
					const { blob } = await git.readBlob({ ...repo, oid: oidA });
					const before = readBlobContent(blob);
					return {
						path: filepath,
						status: "deleted" as const,
						additions: 0,
						deletions: before.isBinary ? 0 : countContentLines(before.text),
						patch: before.isBinary
							? ""
							: createUnifiedPatch({
									path: filepath,
									before: before.text,
									after: "",
									newPath: "/dev/null",
								}),
						isBinary: before.isBinary,
						oldContent: before.isBinary
							? before.buffer.toString("base64")
							: undefined,
						oldSize: before.buffer.length,
					};
				}

				if (!typeA && typeB) {
					const oidB = B ? await B.oid() : "";
					const { blob } = await git.readBlob({ ...repo, oid: oidB });
					const after = readBlobContent(blob);
					return {
						path: filepath,
						status: "added" as const,
						additions: after.isBinary ? 0 : countContentLines(after.text),
						deletions: 0,
						patch: after.isBinary
							? ""
							: createUnifiedPatch({
									path: filepath,
									before: "",
									after: after.text,
									oldPath: "/dev/null",
								}),
						isBinary: after.isBinary,
						newContent: after.isBinary
							? after.buffer.toString("base64")
							: undefined,
						newSize: after.buffer.length,
					};
				}

				const [oidA, oidB] = await Promise.all([
					A ? A.oid() : Promise.resolve(""),
					B ? B.oid() : Promise.resolve(""),
				]);

				if (oidA !== oidB) {
					const [{ blob: blobA }, { blob: blobB }] = await Promise.all([
						git.readBlob({ ...repo, oid: oidA }),
						git.readBlob({ ...repo, oid: oidB }),
					]);
					const before = readBlobContent(blobA);
					const after = readBlobContent(blobB);
					const isBinary = before.isBinary || after.isBinary;

					return {
						path: filepath,
						status: "modified" as const,
						additions: isBinary ? 0 : countContentLines(after.text),
						deletions: isBinary ? 0 : countContentLines(before.text),
						patch: isBinary
							? ""
							: createUnifiedPatch({
									path: filepath,
									before: before.text,
									after: after.text,
								}),
						isBinary,
						oldContent: isBinary ? before.buffer.toString("base64") : undefined,
						newContent: isBinary ? after.buffer.toString("base64") : undefined,
						oldSize: before.buffer.length,
						newSize: after.buffer.length,
					};
				}

				return null;
			},
		});

		const files = (changes ?? []).filter(
			(c: DiffFile | null | undefined): c is DiffFile =>
				c !== null && c !== undefined,
		);

		return {
			files,
			totalAdditions: files.reduce(
				(sum: number, f: DiffFile) => sum + f.additions,
				0,
			),
			totalDeletions: files.reduce(
				(sum: number, f: DiffFile) => sum + f.deletions,
				0,
			),
			totalFiles: files.length,
		};
	} catch (error) {
		throw new Error(`Failed to get commit diff: ${error}`);
	}
}

export async function getDiffBetweenBranches(
	ownerKey: string,
	repoName: string,
	baseBranch: string,
	compareBranch: string,
): Promise<DiffResult> {
	const repo = await getRepoOptions(ownerKey, repoName);

	const [baseOid, compareOid] = await Promise.all([
		git.resolveRef({ ...repo, ref: qualifyBranchRef(baseBranch) }),
		git.resolveRef({ ...repo, ref: qualifyBranchRef(compareBranch) }),
	]);

	const changes = await git.walk({
		...repo,
		trees: [git.TREE({ ref: baseOid }), git.TREE({ ref: compareOid })],
		map: async (filepath, [A, B]) => {
			const [typeA, typeB] = await Promise.all([A?.type(), B?.type()]);

			if (typeA === "tree" || typeB === "tree") return;

			if (typeA && !typeB) {
				const oidA = A ? await A.oid() : "";
				const { blob } = await git.readBlob({ ...repo, oid: oidA });
				const before = readBlobContent(blob);
				return {
					path: filepath,
					status: "deleted" as const,
					additions: 0,
					deletions: before.isBinary ? 0 : countContentLines(before.text),
					patch: before.isBinary
						? ""
						: createUnifiedPatch({
								path: filepath,
								before: before.text,
								after: "",
								newPath: "/dev/null",
							}),
					isBinary: before.isBinary,
					oldContent: before.isBinary
						? before.buffer.toString("base64")
						: undefined,
					oldSize: before.buffer.length,
				};
			}

			if (!typeA && typeB) {
				const oidB = B ? await B.oid() : "";
				const { blob } = await git.readBlob({ ...repo, oid: oidB });
				const after = readBlobContent(blob);
				return {
					path: filepath,
					status: "added" as const,
					additions: after.isBinary ? 0 : countContentLines(after.text),
					deletions: 0,
					patch: after.isBinary
						? ""
						: createUnifiedPatch({
								path: filepath,
								before: "",
								after: after.text,
								oldPath: "/dev/null",
							}),
					isBinary: after.isBinary,
					newContent: after.isBinary
						? after.buffer.toString("base64")
						: undefined,
					newSize: after.buffer.length,
				};
			}

			const [oidA, oidB] = await Promise.all([
				A ? A.oid() : Promise.resolve(""),
				B ? B.oid() : Promise.resolve(""),
			]);

			if (oidA !== oidB) {
				const [{ blob: blobA }, { blob: blobB }] = await Promise.all([
					git.readBlob({ ...repo, oid: oidA }),
					git.readBlob({ ...repo, oid: oidB }),
				]);
				const before = readBlobContent(blobA);
				const after = readBlobContent(blobB);
				const isBinary = before.isBinary || after.isBinary;

				return {
					path: filepath,
					status: "modified" as const,
					additions: isBinary ? 0 : countContentLines(after.text),
					deletions: isBinary ? 0 : countContentLines(before.text),
					patch: isBinary
						? ""
						: createUnifiedPatch({
								path: filepath,
								before: before.text,
								after: after.text,
							}),
					isBinary,
					oldContent: isBinary ? before.buffer.toString("base64") : undefined,
					newContent: isBinary ? after.buffer.toString("base64") : undefined,
					oldSize: before.buffer.length,
					newSize: after.buffer.length,
				};
			}

			return null;
		},
	});

	const files = (changes ?? []).filter(
		(c: DiffFile | null | undefined): c is DiffFile =>
			c !== null && c !== undefined,
	);

	return {
		files,
		totalAdditions: files.reduce(
			(sum: number, f: DiffFile) => sum + f.additions,
			0,
		),
		totalDeletions: files.reduce(
			(sum: number, f: DiffFile) => sum + f.deletions,
			0,
		),
		totalFiles: files.length,
	};
}
