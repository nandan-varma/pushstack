/**
 * Git HTTP protocol service layer using isomorphic-git
 * Handles git-upload-pack (clone/fetch) and git-receive-pack (push) operations
 */

import fs from "fs";
import git from "isomorphic-git";
import { getRepoPath } from "./git-manager-iso";

/**
 * Handle git-upload-pack request (clone/fetch operations)
 * This implements the server side of git clone/fetch
 *
 * @param ownerKey Repository owner key
 * @param repoName Repository name
 * @param requestBody Request body from git client
 * @returns Response body to send back to git client
 */
export async function handleGitUploadPack(
	ownerKey: string,
	repoName: string,
	_requestBody: Buffer,
): Promise<Buffer> {
	const repoPath = getRepoPath(ownerKey, repoName);

	// Verify repository exists
	if (!fs.existsSync(repoPath)) {
		throw new Error("Repository not found on filesystem");
	}

	try {
		// Parse the git request
		// The request body contains the git packfile protocol data
		// We need to respond with the appropriate packfile

		// For now, we'll use a simpler approach: let isomorphic-git handle the protocol
		// In a production implementation, you would parse the request and generate a packfile

		// This is a placeholder - actual implementation would use isomorphic-git's packfile utilities
		// or implement the git protocol manually

		throw new Error(
			"Git upload-pack not fully implemented yet. Use alternative git operations.",
		);
	} catch (error) {
		console.error("Error in handleGitUploadPack:", error);
		throw error;
	}
}

/**
 * Handle git-receive-pack request (push operations)
 * This implements the server side of git push
 *
 * @param ownerKey Repository owner key
 * @param repoName Repository name
 * @param requestBody Request body from git client
 * @returns Response body to send back to git client
 */
export async function handleGitReceivePack(
	ownerKey: string,
	repoName: string,
	_requestBody: Buffer,
): Promise<Buffer> {
	const repoPath = getRepoPath(ownerKey, repoName);

	// Verify repository exists
	if (!fs.existsSync(repoPath)) {
		throw new Error("Repository not found on filesystem");
	}

	try {
		// Parse the git request
		// The request body contains the git packfile with objects to receive

		// This is a placeholder - actual implementation would use isomorphic-git's packfile utilities
		// or implement the git protocol manually

		throw new Error(
			"Git receive-pack not fully implemented yet. Use alternative git operations.",
		);
	} catch (error) {
		console.error("Error in handleGitReceivePack:", error);
		throw error;
	}
}

/**
 * Get git info/refs for a repository (used in initial handshake)
 * This is the first request made by git clone/fetch/push
 *
 * @param ownerKey Repository owner key
 * @param repoName Repository name
 * @param service Service name (git-upload-pack or git-receive-pack)
 * @returns Response body in git protocol format
 */
export async function getGitInfoRefs(
	ownerKey: string,
	repoName: string,
	service: "git-upload-pack" | "git-receive-pack",
): Promise<string> {
	const repoPath = getRepoPath(ownerKey, repoName);

	// Verify repository exists
	if (!fs.existsSync(repoPath)) {
		throw new Error("Repository not found on filesystem");
	}

	try {
		// Get list of refs (branches, tags)
		const refs = await git.listBranches({ fs, dir: repoPath });

		// Build response in git protocol format
		// Format: https://git-scm.com/docs/http-protocol
		let response = `001e# service=${service}\n0000`;

		// Add refs
		for (const ref of refs) {
			try {
				const oid = await git.resolveRef({
					fs,
					dir: repoPath,
					ref: `refs/heads/${ref}`,
				});
				const line = `${oid} refs/heads/${ref}\n`;
				const hexLength = (line.length + 4).toString(16).padStart(4, "0");
				response += `${hexLength}${line}`;
			} catch {}
		}

		// Add capabilities
		// TODO: Add proper git capabilities based on server support
		response += "0000";

		return response;
	} catch (error) {
		console.error("Error in getGitInfoRefs:", error);
		throw error;
	}
}

/**
 * Get repository metadata for git operations
 * @param ownerKey Repository owner key
 * @param repoName Repository name
 * @returns Repository metadata
 */
export async function getRepoMetadata(ownerKey: string, repoName: string) {
	const repoPath = getRepoPath(ownerKey, repoName);

	if (!fs.existsSync(repoPath)) {
		throw new Error("Repository not found on filesystem");
	}

	try {
		const branches = await git.listBranches({ fs, dir: repoPath });
		const tags = await git.listTags({ fs, dir: repoPath });

		// Get default branch
		let defaultBranch = "main";
		if (branches.includes("main")) {
			defaultBranch = "main";
		} else if (branches.includes("master")) {
			defaultBranch = "master";
		} else if (branches.length > 0) {
			defaultBranch = branches[0];
		}

		// Check if repo has commits
		let hasCommits = false;
		let headCommit = null;

		if (branches.length > 0) {
			try {
				headCommit = await git.resolveRef({
					fs,
					dir: repoPath,
					ref: `refs/heads/${defaultBranch}`,
				});
				hasCommits = !!headCommit;
			} catch {
				// No commits yet
				hasCommits = false;
			}
		}

		return {
			path: repoPath,
			branches,
			tags,
			defaultBranch,
			hasCommits,
			headCommit,
		};
	} catch (error) {
		console.error("Error getting repo metadata:", error);
		throw error;
	}
}

/**
 * Check if repository is empty (has no commits)
 * @param ownerKey Repository owner key
 * @param repoName Repository name
 * @returns true if repository has no commits
 */
export async function isEmptyRepo(
	ownerKey: string,
	repoName: string,
): Promise<boolean> {
	try {
		const metadata = await getRepoMetadata(ownerKey, repoName);
		return !metadata.hasCommits;
	} catch {
		// If we can't get metadata, assume not empty to avoid showing setup page
		return false;
	}
}
