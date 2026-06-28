/**
 * Git Diff Service (isomorphic-git)
 *
 * Generate diffs and compare branches/commits.
 */

import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { getBareRepoOptions } from "./git-manager-iso";
import { getCommit, getFileContent } from "./git-operations-iso";
import { ensureRepositoryHydrated } from "./git-repo-storage";

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

async function getRepoOptions(
	ownerKey: string,
	repoName: string,
	legacyOwnerKeys: string[] = [],
) {
	if (!isR2Configured()) {
		await ensureRepositoryHydrated(ownerKey, repoName, legacyOwnerKeys);
	}
	return getBareRepoOptions(ownerKey, repoName);
}

/**
 * Simple unified diff generator
 */
function generateUnifiedDiff(
	path: string,
	oldContent: string,
	newContent: string,
): string {
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");

	let diff = `diff --git a/${path} b/${path}\n`;
	diff += `--- a/${path}\n`;
	diff += `+++ b/${path}\n`;

	// Simple line-by-line diff (not optimal but functional)
	let additions = 0;
	let deletions = 0;
	let hunk = "@@ -1," + oldLines.length + " +1," + newLines.length + " @@\n";

	for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
		if (i < oldLines.length && i < newLines.length) {
			if (oldLines[i] !== newLines[i]) {
				hunk += `-${oldLines[i]}\n`;
				hunk += `+${newLines[i]}\n`;
				deletions++;
				additions++;
			} else {
				hunk += ` ${oldLines[i]}\n`;
			}
		} else if (i < oldLines.length) {
			hunk += `-${oldLines[i]}\n`;
			deletions++;
		} else {
			hunk += `+${newLines[i]}\n`;
			additions++;
		}
	}

	diff += hunk;

	return diff;
}

/**
 * Get diff between two commits
 */
export async function getCommitDiff(
	ownerKey: string,
	repoName: string,
	commitSha: string,
	legacyOwnerKeys: string[] = [],
): Promise<DiffResult> {
	const repo = await getRepoOptions(ownerKey, repoName, legacyOwnerKeys);

	try {
		// Get commit info
		const commit = await getCommit(
			ownerKey,
			repoName,
			commitSha,
			legacyOwnerKeys,
		);
		const parent = commit.commit.parent[0];

		if (!parent) {
			// Initial commit - all files are additions
			const tree = await git.readTree({ ...repo, oid: commit.commit.tree });
			const files: DiffFile[] = [];

			for (const entry of tree.tree) {
				if (entry.type === "blob") {
					const content = await getFileContent(
						ownerKey,
						repoName,
						entry.path,
						commitSha,
						legacyOwnerKeys,
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
				totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
				totalDeletions: 0,
				totalFiles: files.length,
			};
		}

		// Compare with parent
		const changes = await git.walk({
			...repo,
			trees: [git.TREE({ ref: parent }), git.TREE({ ref: commitSha })],
			map: async (filepath, [A, B]) => {
				const typeA = await A?.type();
				const typeB = await B?.type();

				// Return undefined (not null) so isomorphic-git descends into subdirs
				if (typeA === "tree" || typeB === "tree") return;

				// File deleted
				if (typeA && !typeB) {
					const oidA = A ? await A.oid() : "";
					const { blob } = await git.readBlob({ ...repo, oid: oidA });
					const lines = Buffer.from(blob).toString().split("\n");
					return {
						path: filepath,
						status: "deleted" as const,
						additions: 0,
						deletions: lines.length,
						patch: `--- a/${filepath}\n${lines.map((l) => `-${l}`).join("\n")}`,
					};
				}

				// File added
				if (!typeA && typeB) {
					const oidB = B ? await B.oid() : "";
					const { blob } = await git.readBlob({ ...repo, oid: oidB });
					const lines = Buffer.from(blob).toString().split("\n");
					return {
						path: filepath,
						status: "added" as const,
						additions: lines.length,
						deletions: 0,
						patch: `+++ b/${filepath}\n${lines.map((l) => `+${l}`).join("\n")}`,
					};
				}

				// File modified
				const oidA = A ? await A.oid() : "";
				const oidB = B ? await B.oid() : "";

				if (oidA !== oidB) {
					const { blob: blobA } = await git.readBlob({ ...repo, oid: oidA });
					const { blob: blobB } = await git.readBlob({ ...repo, oid: oidB });
					const contentA = Buffer.from(blobA).toString();
					const contentB = Buffer.from(blobB).toString();

					const linesA = contentA.split("\n");
					const linesB = contentB.split("\n");

					const additions = linesB.length;
					const deletions = linesA.length;

					return {
						path: filepath,
						status: "modified" as const,
						additions,
						deletions,
						patch: generateUnifiedDiff(filepath, contentA, contentB),
					};
				}

				return null;
			},
		});

		const files = (changes ?? []).filter(
			(c): c is DiffFile => c !== null && c !== undefined,
		);

		return {
			files,
			totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
			totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
			totalFiles: files.length,
		};
	} catch (error) {
		throw new Error(`Failed to get commit diff: ${error}`);
	}
}

/**
 * Get diff between two branches
 */
export async function getDiffBetweenBranches(
	ownerKey: string,
	repoName: string,
	baseBranch: string,
	compareBranch: string,
	legacyOwnerKeys: string[] = [],
): Promise<DiffResult> {
	const repo = await getRepoOptions(ownerKey, repoName, legacyOwnerKeys);

	const baseOid = await git.resolveRef({ ...repo, ref: baseBranch });
	const compareOid = await git.resolveRef({ ...repo, ref: compareBranch });

	const changes = await git.walk({
		...repo,
		trees: [git.TREE({ ref: baseOid }), git.TREE({ ref: compareOid })],
		map: async (filepath, [A, B]) => {
			const typeA = await A?.type();
			const typeB = await B?.type();

			// Return undefined (not null) so isomorphic-git descends into subdirs
			if (typeA === "tree" || typeB === "tree") return;

			if (typeA && !typeB) {
				const oidA = A ? await A.oid() : "";
				const { blob } = await git.readBlob({ ...repo, oid: oidA });
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
				const oidB = B ? await B.oid() : "";
				const { blob } = await git.readBlob({ ...repo, oid: oidB });
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

				const linesA = contentA.split("\n");
				const linesB = contentB.split("\n");

				return {
					path: filepath,
					status: "modified" as const,
					additions: linesB.length,
					deletions: linesA.length,
					patch: generateUnifiedDiff(filepath, contentA, contentB),
				};
			}

			return null;
		},
	});

	const files = (changes ?? []).filter(
		(c): c is DiffFile => c !== null && c !== undefined,
	);

	return {
		files,
		totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
		totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
		totalFiles: files.length,
	};
}

/**
 * Check for merge conflicts between branches
 */
export async function checkForConflicts(
	_ownerId: number,
	_repoName: string,
	_sourceBranch: string,
	_targetBranch: string,
): Promise<{ hasConflicts: boolean; conflictingFiles: string[] }> {
	// For isomorphic-git, we need to attempt a merge to check for conflicts
	// For now, return a simple check
	// TODO: Implement actual conflict detection by attempting merge
	// const diff = await getDiffBetweenBranches(ownerId, repoName, targetBranch, sourceBranch);

	// This is a simplified check - real conflict detection requires merge attempt
	return {
		hasConflicts: false,
		conflictingFiles: [],
	};
}
