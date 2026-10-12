/** Scopes a personal access token can carry. `repo:write` implies read. */
export const TOKEN_SCOPES = ["repo:read", "repo:write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const TOKEN_SCOPE_LABELS: Record<TokenScope, string> = {
	"repo:read": "Read repositories (clone, fetch)",
	"repo:write": "Read and write repositories (clone, fetch, push)",
};

/** Personal access tokens start with this, so git auth can tell them from passwords. */
export const TOKEN_PREFIX = "ghp_";

export function tokenAllows(
	scopes: readonly TokenScope[],
	required: TokenScope,
): boolean {
	return required === "repo:read"
		? scopes.length > 0
		: scopes.includes("repo:write");
}
