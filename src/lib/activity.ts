export function describeActivity(activity: {
	type: string;
	metadata: unknown;
	repository?: {
		name: string;
		owner?: { username?: string | null } | null;
	} | null;
	id: number;
}): {
	text: string;
	showRepo: boolean;
	linkTo?: string;
	linkParams?: Record<string, string>;
} {
	const meta = (activity.metadata ?? {}) as Record<string, unknown>;
	const title = typeof meta.title === "string" ? meta.title : null;
	const action = typeof meta.action === "string" ? meta.action : null;
	const repoOwner = activity.repository?.owner?.username || "unknown";
	const repoName = activity.repository?.name || "";
	const repoParams = { owner: repoOwner, name: repoName };

	switch (activity.type) {
		case "create_repo":
			return {
				text: "Created this repository",
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
		case "star":
			return {
				text: "Starred",
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
		case "commit":
			return {
				text:
					typeof meta.message === "string"
						? `Pushed a commit: "${meta.message}"`
						: "Pushed a commit",
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
		case "issue": {
			const issueId = typeof meta.issueId === "number" ? meta.issueId : null;
			return {
				text: `${action === "closed" ? "Closed" : action === "reopened" ? "Reopened" : "Opened"} issue${title ? ` "${title}"` : ""}`,
				showRepo: true,
				linkTo: issueId
					? "/repo/$owner/$name/issues/$id"
					: "/repo/$owner/$name/issues",
				linkParams: issueId
					? { ...repoParams, id: String(issueId) }
					: repoParams,
			};
		}
		case "pr": {
			const prId = typeof meta.prId === "number" ? meta.prId : null;
			return {
				text: `${action === "merged" ? "Merged" : action === "closed" ? "Closed" : "Opened"} pull request${title ? ` "${title}"` : ""}`,
				showRepo: true,
				linkTo: prId
					? "/repo/$owner/$name/pulls/$id"
					: "/repo/$owner/$name/pulls",
				linkParams: prId ? { ...repoParams, id: String(prId) } : repoParams,
			};
		}
		case "comment":
			return {
				text: `Commented on ${meta.prId ? "a pull request" : "an issue"}`,
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
		default:
			return {
				text: activity.type,
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
	}
}
