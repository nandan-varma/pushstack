/**
 * What a user may do with a gist. Reading needs no permission once the gist
 * exists: a secret gist is unlisted, not private, and anyone holding its id
 * reads it. Writing is the owner's.
 */
export interface GistAccess {
	canRead: boolean;
	canWrite: boolean;
	role: "owner" | "anonymous";
}

export function getAccessForGist(
	gist: { ownerId: string },
	userId?: string | null,
): GistAccess {
	const canWrite = !!userId && gist.ownerId === userId;
	return { canRead: true, canWrite, role: canWrite ? "owner" : "anonymous" };
}
