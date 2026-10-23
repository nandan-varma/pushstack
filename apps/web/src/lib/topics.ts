import { MAX_REPO_TOPIC_CHARS, MAX_REPO_TOPICS } from "./limits";

/** GitHub's rule: lowercase letters, digits and hyphens, starting with a letter or digit. */
const TOPIC_RE = new RegExp(
	`^[a-z0-9][a-z0-9-]{0,${MAX_REPO_TOPIC_CHARS - 1}}$`,
);

export const isValidTopic = (name: string) => TOPIC_RE.test(name);

/**
 * Split `names` into the valid topics (deduplicated, order kept) and the
 * rejected ones. More than {@link MAX_REPO_TOPICS} valid topics is `tooMany`.
 */
export function parseTopics(names: readonly string[]): {
	topics: string[];
	invalid: string[];
	tooMany: boolean;
} {
	const topics: string[] = [];
	const invalid: string[] = [];
	for (const name of names) {
		if (!isValidTopic(name)) invalid.push(name);
		else if (!topics.includes(name)) topics.push(name);
	}
	return { topics, invalid, tooMany: topics.length > MAX_REPO_TOPICS };
}

/**
 * `topic:foo` qualifiers (every one must match, as on GitHub) and the rest of
 * the query, which matches the repository name.
 */
export function parseRepositoryQuery(query: string): {
	text: string;
	topics: string[];
} {
	const topics: string[] = [];
	const words: string[] = [];
	for (const word of query.split(/\s+/).filter(Boolean)) {
		const match = /^topic:(.+)$/i.exec(word);
		if (match) topics.push((match[1] as string).toLowerCase());
		else words.push(word);
	}
	return { text: words.join(" "), topics };
}
