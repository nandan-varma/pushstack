import { MAX_DISCUSSION_CATEGORY_SLUG_CHARS } from "./limits";

export type DiscussionCategoryFormat = "open" | "announcement" | "q_and_a";

/** GitHub's `DiscussionStateReason`; a discussion closes with one of these. */
export type DiscussionStateReason =
	| "duplicate"
	| "outdated"
	| "reopened"
	| "resolved";

export interface DefaultDiscussionCategory {
	name: string;
	emoji: string;
	description: string;
	format: DiscussionCategoryFormat;
}

/** GitHub's five categories, in the order every new repository gets them. */
export const DEFAULT_DISCUSSION_CATEGORIES: readonly DefaultDiscussionCategory[] =
	[
		{
			name: "General",
			emoji: "💬",
			description:
				"Create a conversation that is not specific to any other category.",
			format: "open",
		},
		{
			name: "Ideas",
			emoji: "💡",
			description: "Share ideas for new features or improvements.",
			format: "open",
		},
		{
			name: "Q&A",
			emoji: "🙏",
			description: "Ask the community for help.",
			format: "q_and_a",
		},
		{
			name: "Announcements",
			emoji: "📣",
			description: "Updates from the maintainers.",
			format: "announcement",
		},
		{
			name: "Show and tell",
			emoji: "🙌",
			description: "Show off something you have made.",
			format: "open",
		},
	];

/**
 * The category slug GraphQL's `discussionCategory(slug:)` addresses: lowercase
 * `a-z0-9-`, runs collapsed, trimmed at both ends and capped. Derived from the
 * name server-side so a caller never supplies a slug or a path.
 */
export function discussionCategorySlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, MAX_DISCUSSION_CATEGORY_SLUG_CHARS)
		.replace(/^-+|-+$/g, "");
}
