import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { threadPageSchema } from "#/lib/thread-page";
import { readWithAccess } from "./repo-access";
import { findThreadByNumber } from "./thread-store";
import { listTimeline } from "./timeline-store";

export const getTimeline = createServerFn({ method: "GET" })
	.validator(
		z
			.object({ repoId: z.number(), number: z.number().int().min(1) })
			.and(threadPageSchema),
	)
	.handler(({ data }) =>
		readWithAccess(`getTimeline #${data.number}`, data.repoId, async () => {
			const thread = await findThreadByNumber(data.repoId, data.number);
			if (!thread) return [];
			return listTimeline(thread.id, {
				limit: data.limit,
				offset: data.skip,
			});
		}),
	);
