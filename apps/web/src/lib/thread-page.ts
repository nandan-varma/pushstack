import { z } from "zod";
import {
	MAX_LIST_SKIP,
	MAX_THREAD_PAGE_SIZE,
	THREAD_PAGE_SIZE,
} from "#/lib/limits";

/** `limit` / `skip` of a thread's comments or timeline read, both bounded. */
export const threadPageSchema = z.object({
	limit: z
		.number()
		.int()
		.min(1)
		.max(MAX_THREAD_PAGE_SIZE)
		.default(THREAD_PAGE_SIZE),
	skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
});
