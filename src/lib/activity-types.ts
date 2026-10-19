/** One entry of the activity feed: what happened, with its type's metadata. */
export type ActivityEvent =
	| { type: "create_repo"; metadata: { repoName: string } }
	| { type: "star"; metadata: null }
	| {
			type: "commit";
			metadata: { commitSha: string; message: string };
	  }
	| {
			type: "issue";
			metadata: {
				/** The repo-scoped issue number (route param), not the row id. */
				number: number;
				title: string;
				action: "opened" | "closed" | "reopened";
			};
	  }
	| {
			type: "pr";
			metadata: {
				number: number;
				title: string;
				action: "opened" | "closed" | "reopened" | "merged";
			};
	  }
	| {
			type: "comment";
			metadata: { on: "issue" | "pr"; number: number };
	  };

export type ActivityType = ActivityEvent["type"];
export type ActivityMetadata = ActivityEvent["metadata"];
