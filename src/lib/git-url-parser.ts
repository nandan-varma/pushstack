/**
 * Git URL Parser
 * Parses git protocol URLs from HTTP requests
 */

export interface ParsedGitUrl {
	owner: string;
	repo: string;
	service?: "git-upload-pack" | "git-receive-pack";
	isInfoRefs: boolean;
	rawPath: string;
}

/**
 * Parse git protocol URL
 * Handles patterns like:
 * - /api/git/owner/repo.git/info/refs?service=git-upload-pack
 * - /api/git/owner/repo.git/git-upload-pack
 * - /api/git/owner/repo/info/refs (without .git)
 */
export function parseGitUrl(url: string): ParsedGitUrl | null {
	try {
		const urlObj = new URL(url);
		const pathname = urlObj.pathname;
		const searchParams = urlObj.searchParams;

		// Remove leading /api/git/
		const gitPath = pathname.replace(/^\/api\/git\//, "");
		const parts = gitPath.split("/").filter(Boolean);

		if (parts.length < 2) {
			return null;
		}

		// Extract owner and repo
		const owner = parts[0];
		const repoWithExt = parts[1];

		// Remove .git extension if present
		const repo = repoWithExt.replace(/\.git$/, "");

		// Check for info/refs
		const isInfoRefs = parts[2] === "info" && parts[3] === "refs";

		// Get service from query params or path
		let service: "git-upload-pack" | "git-receive-pack" | undefined;

		if (isInfoRefs) {
			const serviceParam = searchParams.get("service");
			if (
				serviceParam === "git-upload-pack" ||
				serviceParam === "git-receive-pack"
			) {
				service = serviceParam;
			}
		} else if (parts[2] === "git-upload-pack") {
			service = "git-upload-pack";
		} else if (parts[2] === "git-receive-pack") {
			service = "git-receive-pack";
		}

		return {
			owner,
			repo,
			service,
			isInfoRefs,
			rawPath: pathname,
		};
	} catch {
		return null;
	}
}

/**
 * Validate git repository path
 */
export function isValidGitPath(path: string): boolean {
	// Basic validation: should contain owner/repo pattern
	const parts = path.split("/").filter(Boolean);
	return parts.length >= 2 && parts.every((p) => /^[a-zA-Z0-9_-]+$/.test(p));
}
