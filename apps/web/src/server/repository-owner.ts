/**
 * A repository owner as every lookup names it: a user's username, or an
 * organization's login (both are its storage prefix). Organizations are shown
 * through the same view so `owner.login`, `owner.username` and `owner.id` read
 * the same everywhere; `kind` is what serializers switch on.
 */
import { user } from "#/db/schema";

/** The user columns safe to show anyone (never the email). */
export const publicUserColumns = {
	id: user.id,
	apiId: user.apiId,
	username: user.username,
	name: user.name,
	image: user.image,
};
export const publicUserFields = {
	columns: { id: true, apiId: true, username: true, name: true, image: true },
} as const;

/** A repository's owner as storage and its URLs name it. */
export const repoOwnerColumns = { ...publicUserColumns, login: user.username };

export type PublicUser = {
	id: string;
	apiId: number;
	username: string;
	name: string;
	image: string | null;
	kind?: "user" | "organization";
};

export type RepositoryOwner = PublicUser & { login: string };

/** The owner a joined row names: a user, or the organization with its login. */
export function repositoryOwnerOf(row: {
	owner: PublicUser | null;
	organization: { id: number; login: string; name: string | null } | null;
}): RepositoryOwner {
	if (row.organization) {
		const { id, login, name } = row.organization;
		return {
			id: "",
			apiId: id,
			username: login,
			name: name ?? login,
			image: null,
			login,
			kind: "organization",
		};
	}
	if (row.owner) {
		return { ...row.owner, login: row.owner.username, kind: "user" };
	}
	throw new Error("Repository has no owner");
}
