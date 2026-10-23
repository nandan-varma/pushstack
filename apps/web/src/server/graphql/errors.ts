/**
 * GitHub-shaped GraphQL errors. GitHub puts a machine-readable `type` beside
 * the message (`{"type":"NOT_FOUND","path":["repository"],...}`), not under
 * `extensions`; gh matches on it (for example NOT_FOUND, FORBIDDEN).
 */
import { GraphQLError, type GraphQLFormattedError } from "graphql";

export type GitHubErrorType =
	| "NOT_FOUND"
	| "FORBIDDEN"
	| "UNPROCESSABLE"
	| "INSUFFICIENT_SCOPES"
	| "MAX_NODE_LIMIT_EXCEEDED"
	| "MAX_DEPTH_EXCEEDED"
	| "EXCESSIVE_PAGINATION"
	| "MISSING_PAGINATION_BOUNDARIES"
	| "RATE_LIMITED"
	| "INTERNAL";

export class GitHubGraphQLError extends GraphQLError {
	constructor(
		readonly type: GitHubErrorType,
		message: string,
	) {
		super(message, { extensions: { type } });
	}
}

export const notFound = (message: string) =>
	new GitHubGraphQLError("NOT_FOUND", message);

export const forbidden = (message: string) =>
	new GitHubGraphQLError("FORBIDDEN", message);

export const unprocessable = (message: string) =>
	new GitHubGraphQLError("UNPROCESSABLE", message);

/** GitHub's wording when a lookup by owner and name finds nothing readable. */
export const repositoryNotFound = (owner: string, name: string) =>
	notFound(
		`Could not resolve to a Repository with the name '${owner}/${name}'.`,
	);

export interface GitHubFormattedError {
	type?: string;
	path?: GraphQLFormattedError["path"];
	locations?: GraphQLFormattedError["locations"];
	message: string;
}

/** One error as GitHub serializes it: `type` first, never `extensions`. */
export function formatError(error: GraphQLError): GitHubFormattedError {
	const formatted = error.toJSON();
	const type = error.extensions?.type;
	return {
		...(typeof type === "string" && { type }),
		...(formatted.path && { path: formatted.path }),
		...(formatted.locations && { locations: formatted.locations }),
		message: formatted.message,
	};
}
