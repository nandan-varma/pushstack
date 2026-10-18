/** Clone URLs and first-push instructions shown for a repository. */

/** This deployment's origin: the page's in a browser, BETTER_AUTH_URL on the server. */
function getGitBaseUrl(): string {
	if (typeof window !== "undefined") return window.location.origin;
	const authUrl = process.env.BETTER_AUTH_URL;
	if (!authUrl) {
		throw new Error(
			"BETTER_AUTH_URL must be set to build clone URLs on the server",
		);
	}
	return authUrl.replace(/\/$/, "");
}

export function getCloneUrl(owner: string, repoName: string): string {
	return `${getGitBaseUrl()}/api/git/${owner}/${repoName}.git`;
}

export function getSetupInstructions(repoName: string, cloneUrl: string) {
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
