import { isNotFound, redirect } from "@tanstack/react-router";

/** Issues and pull requests share one number sequence. */
export async function ensureThreadNumberRedirect(
	error: unknown,
	params: { owner: string; name: string; id: string },
	findOther: () => Promise<unknown>,
	otherRoute: "/$owner/$name/issues/$id" | "/$owner/$name/pulls/$id",
): Promise<never> {
	if (!isNotFound(error)) throw error;
	const other = await findOther().catch((otherError: unknown) => {
		if (!isNotFound(otherError)) throw otherError;
		return null;
	});
	if (other) throw redirect({ to: otherRoute, params, statusCode: 301 });
	throw error;
}
