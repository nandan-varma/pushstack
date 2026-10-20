/**
 * Validators for GET server functions whose input comes from the URL.
 *
 * TanStack Start turns a failed schema into a plain `Error`, which a route
 * loader surfaces as a 500. On a read, input that can't name anything (a
 * branch with `..`, a path that escapes the tree, a non-sha commit, an issue
 * number past int4) is a URL that points at nothing — GitHub answers 404, and
 * so does this. Write functions keep their validation errors.
 */
import { notFound } from "@tanstack/react-router";
import { z } from "zod";

/** A `#N` from a URL: positive and within Postgres `integer`. */
export const threadNumberSchema = z
	.number()
	.int()
	.positive()
	.max(2_147_483_647);

/** `schema`'s parse as a server-function validator that 404s bad input. */
export function readInput<S extends z.ZodType>(schema: S) {
	return (input: z.input<S>): z.output<S> => {
		const parsed = schema.safeParse(input);
		if (!parsed.success) throw notFound();
		return parsed.data;
	};
}
