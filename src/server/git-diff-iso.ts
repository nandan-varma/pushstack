import { createPatch } from "diff";
import git from "isomorphic-git";
import { getCommit, getFileContent } from "./git-operations-iso";
import { getRepoOptions } from "./git-repo-storage";

export interface DiffFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
	additions: number;
	deletions: number;
	patch: string;
	oldPath?: string;
}

export interface DiffResult {
	files: DiffFile[];
	totalAdditions: number;
	totalDeletions: number;
	totalFiles: number;
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
			const files: DiffFile[] = [];

			for (const entry of tree.tree) {
				if (entry.type === "blob") {
					const content = await getFileContent(
						ownerKey,
						repoName,
						entry.path,
						commitSha,
					);
					const lines = content.toString().split("\n");
					files.push({
						path: entry.path,
						status: "added",
						additions: lines.length,
						deletions: 0,
						patch: `+++ b/${entry.path}\n${lines.map((l) => `+${l}`).join("\n")}`,
					});
				}
			}

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
				const typeA = await A?.type();
				const typeB = await B?.type();

				if (typeA === "tree" || typeB === "tree") return;

				if (typeA && !typeB) {
					const { blob } = await git.readBlob({
						...repo,
						oid: A ? await A.oid() : "",
					});
					const lines = Buffer.from(blob).toString().split("\n");
					return {
						path: filepath,
						status: "deleted" as const,
						additions: 0,
						deletions: lines.length,
						patch: `--- a/${filepath}\n${lines.map((l) => `-${l}`).join("\n")}`,
					};
				}

				if (!typeA && typeB) {
					const { blob } = await git.readBlob({
						...repo,
						oid: B ? await B.oid() : "",
					});
					const lines = Buffer.from(blob).toString().split("\n");
					return {
						path: filepath,
						status: "added" as const,
						additions: lines.length,
						deletions: 0,
						patch: `+++ b/${filepath}\n${lines.map((l) => `+${l}`).join("\n")}`,
					};
				}

				const oidA = A ? await A.oid() : "";
				const oidB = B ? await B.oid() : "";

				if (oidA !== oidB) {
					const { blob: blobA } = await git.readBlob({ ...repo, oid: oidA });
					const { blob: blobB } = await git.readBlob({ ...repo, oid: oidB });
					const contentA = Buffer.from(blobA).toString();
					const contentB = Buffer.from(blobB).toString();

					return {
						path: filepath,
						status: "modified" as const,
						additions: contentB.split("\n").length,
						deletions: contentA.split("\n").length,
						patch: createPatch(filepath, contentA, contentB),
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

	const baseOid = await git.resolveRef({ ...repo, ref: baseBranch });
	const compareOid = await git.resolveRef({ ...repo, ref: compareBranch });

	const changes = await git.walk({
		...repo,
		trees: [git.TREE({ ref: baseOid }), git.TREE({ ref: compareOid })],
		map: async (filepath, [A, B]) => {
			const typeA = await A?.type();
			const typeB = await B?.type();

			if (typeA === "tree" || typeB === "tree") return;

			if (typeA && !typeB) {
				const { blob } = await git.readBlob({
					...repo,
					oid: A ? await A.oid() : "",
				});
				const lines = Buffer.from(blob).toString().split("\n");
				return {
					path: filepath,
					status: "deleted" as const,
					additions: 0,
					deletions: lines.length,
					patch: `--- a/${filepath}\n${lines.map((l) => `-${l}`).join("\n")}`,
				};
			}

			if (!typeA && typeB) {
				const { blob } = await git.readBlob({
					...repo,
					oid: B ? await B.oid() : "",
				});
				const lines = Buffer.from(blob).toString().split("\n");
				return {
					path: filepath,
					status: "added" as const,
					additions: lines.length,
					deletions: 0,
					patch: `+++ b/${filepath}\n${lines.map((l) => `+${l}`).join("\n")}`,
				};
			}

			const oidA = A ? await A.oid() : "";
			const oidB = B ? await B.oid() : "";

			if (oidA !== oidB) {
				const { blob: blobA } = await git.readBlob({ ...repo, oid: oidA });
				const { blob: blobB } = await git.readBlob({ ...repo, oid: oidB });
				const contentA = Buffer.from(blobA).toString();
				const contentB = Buffer.from(blobB).toString();

				return {
					path: filepath,
					status: "modified" as const,
					additions: contentB.split("\n").length,
					deletions: contentA.split("\n").length,
					patch: createPatch(filepath, contentA, contentB),
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
