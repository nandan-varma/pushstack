import { isNotFound, redirect } from "@tanstack/react-router";

export type ThreadRoute =
	| "/$owner/$name/issues/$id"
	| "/$owner/$name/pull/$id/{-$tab}"
	| "/$owner/$name/discussions/$id";

/**
 * A `#N` that is not the requested kind answers its own URL with GitHub's 301,
 * probing each candidate in order and only after the requested read failed
 * with not found (an operational failure is never read as a conversion).
 */
export async function ensureThreadNumberRedirect(
	error: unknown,
	params: { owner: string; name: string; id: string },
	others: { route: ThreadRoute; find: () => Promise<unknown> }[],
): Promise<never> {
	if (!isNotFound(error)) throw error;
	for (const other of others) {
		const found = await other.find().catch((otherError: unknown) => {
			if (!isNotFound(otherError)) throw otherError;
			return null;
		});
		if (found) throw redirect({ to: other.route, params, statusCode: 301 });
	}
	throw error;
}
