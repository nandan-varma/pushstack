import type {
	ActivityEvent,
	ActivityMetadata,
	ActivityType,
} from "./activity-types";

export interface ActivityRow {
	id: number;
	type: ActivityType;
	metadata: ActivityMetadata | null;
	createdAt: string | Date;
	repository: { name: string; owner: { username: string | null } } | null;
}

type ActivityLink =
	| { to: "/$owner/$name"; params: { owner: string; name: string } }
	| {
			to: "/$owner/$name/commit/$sha";
			params: { owner: string; name: string; sha: string };
	  }
	| {
			to: "/$owner/$name/issues/$id" | "/$owner/$name/pulls/$id";
			params: { owner: string; name: string; id: string };
	  };

/** The sentence and link an activity-feed entry renders as. */
export function describeActivity(row: ActivityRow): {
	text: string;
	link: ActivityLink | null;
} {
	// type and metadata are written together by recordActivity, so the row is
	// one ActivityEvent; the database just can't express the correlation.
	const event = { type: row.type, metadata: row.metadata } as ActivityEvent;
	const owner = row.repository?.owner.username;
	const name = row.repository?.name;
	const repo = owner && name ? { owner, name } : null;
	const thread = (kind: "issue" | "pr", number: number): ActivityLink | null =>
		repo && {
			to:
				kind === "issue"
					? "/$owner/$name/issues/$id"
					: "/$owner/$name/pulls/$id",
			params: { ...repo, id: String(number) },
		};
	const home: ActivityLink | null = repo && {
		to: "/$owner/$name",
		params: repo,
	};

	switch (event.type) {
		case "create_repo":
			return { text: "Created this repository", link: home };
		case "star":
			return { text: "Starred", link: home };
		case "commit":
			return {
				text: `Committed "${event.metadata.message}"`,
				link: repo && {
					to: "/$owner/$name/commit/$sha",
					params: { ...repo, sha: event.metadata.commitSha },
				},
			};
		case "issue": {
			const verb = { opened: "Opened", closed: "Closed", reopened: "Reopened" };
			return {
				text: `${verb[event.metadata.action]} issue "${event.metadata.title}"`,
				link: thread("issue", event.metadata.number),
			};
		}
		case "pr": {
			const verb = {
				opened: "Opened",
				closed: "Closed",
				reopened: "Reopened",
				merged: "Merged",
			};
			return {
				text: `${verb[event.metadata.action]} pull request "${event.metadata.title}"`,
				link: thread("pr", event.metadata.number),
			};
		}
		case "comment":
			return {
				text: `Commented on ${event.metadata.on === "pr" ? "a pull request" : "an issue"}`,
				link: thread(event.metadata.on, event.metadata.number),
			};
	}
}
