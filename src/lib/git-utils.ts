/**
 * Git utility functions for clone URLs and repository operations
 */

/**
 * Get the base URL for git operations
 * Uses BETTER_AUTH_URL from environment if available, otherwise falls back to window.location.origin
 */
export function getGitBaseUrl(): string {
	if (typeof window !== "undefined") {
		return window.location.origin;
	}

	// Server-side: use BETTER_AUTH_URL from environment
	const authUrl =
		process.env.BETTER_AUTH_URL || process.env.VITE_BETTER_AUTH_URL;
	if (authUrl) {
		return authUrl.replace(/\/$/, ""); // Remove trailing slash
	}

	return "http://localhost:3000";
}

/**
 * Generate git clone URL for a repository
 * @param owner Repository owner username
 * @param repoName Repository name
 * @param protocol 'https' (only HTTPS supported for now, SSH later)
 * @returns Formatted git clone URL
 */
export function getCloneUrl(
	owner: string,
	repoName: string,
	protocol: "https" = "https",
): string {
	const baseUrl = getGitBaseUrl();

	if (protocol === "https") {
		// Format: https://example.com/api/git/{owner}/{repo}.git
		return `${baseUrl}/api/git/${owner}/${repoName}.git`;
	}

	throw new Error(`Protocol ${protocol} not supported yet`);
}

/**
 * Get setup instructions for a new repository
 * @param owner Repository owner username
 * @param repoName Repository name
 * @param cloneUrl Clone URL for the repository
 * @returns Object with different setup instruction blocks
 */
export function getSetupInstructions(
	_owner: string,
	repoName: string,
	cloneUrl: string,
) {
	return {
		newRepo: `echo "# ${repoName}" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin ${cloneUrl}
git push -u origin main`,

		existingRepo: `git remote add origin ${cloneUrl}
git branch -M main
git push -u origin main`,

		importRepo: `git clone ${cloneUrl}
cd ${repoName}
# Make changes
git add .
git commit -m "your commit message"
git push`,
	};
}

/**
 * Check if a git ref is valid
 * @param ref Git reference (branch name, tag, commit SHA)
 * @returns true if valid
 */
export function isValidGitRef(ref: string): boolean {
	// Basic validation: alphanumeric, hyphens, underscores, forward slashes
	// No consecutive dots, no trailing/leading dots or slashes
	const pattern = /^(?!.*\.\.)[a-zA-Z0-9._/-]+(?<!\/)$/;
	return pattern.test(ref) && ref.length > 0 && ref.length <= 255;
}

/**
 * Sanitize repository name to be filesystem-safe
 * @param name Repository name
 * @returns Sanitized name
 */
export function sanitizeRepoName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "-") // Replace invalid chars with hyphen
		.replace(/-+/g, "-") // Replace multiple hyphens with single
		.replace(/^-|-$/g, "") // Remove leading/trailing hyphens
		.slice(0, 100); // Max length
}
