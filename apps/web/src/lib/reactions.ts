/** GitHub's reaction `content` values, in GitHub's picker order. */
export const REACTION_CONTENTS = [
	"+1",
	"-1",
	"laugh",
	"hooray",
	"confused",
	"heart",
	"rocket",
	"eyes",
] as const;

export type ReactionContent = (typeof REACTION_CONTENTS)[number];

export const REACTION_EMOJI: Record<ReactionContent, string> = {
	"+1": "👍",
	"-1": "👎",
	laugh: "😄",
	hooray: "🎉",
	confused: "😕",
	heart: "❤️",
	rocket: "🚀",
	eyes: "👀",
};

/** Human names for screen readers. */
export const REACTION_LABEL: Record<ReactionContent, string> = {
	"+1": "thumbs up",
	"-1": "thumbs down",
	laugh: "laugh",
	hooray: "hooray",
	confused: "confused",
	heart: "heart",
	rocket: "rocket",
	eyes: "eyes",
};

/** GitHub's `reactions` rollup on an issue, pull request or comment (minus `url`). */
export type ReactionRollup = { total_count: number } & Record<
	ReactionContent,
	number
>;

export function emptyReactionRollup(): ReactionRollup {
	return {
		total_count: 0,
		"+1": 0,
		"-1": 0,
		laugh: 0,
		hooray: 0,
		confused: 0,
		heart: 0,
		rocket: 0,
		eyes: 0,
	};
}

/** One subject's rollup plus the contents the viewer has reacted with. */
export interface ReactionSummary {
	reactions: ReactionRollup;
	viewerReactions: ReactionContent[];
}

/** Every reaction summary in a thread: the issue/PR itself and its comments by id. */
export interface ThreadReactions {
	issue: ReactionSummary;
	comments: Record<number, ReactionSummary>;
}

export function emptyReactionSummary(): ReactionSummary {
	return { reactions: emptyReactionRollup(), viewerReactions: [] };
}
