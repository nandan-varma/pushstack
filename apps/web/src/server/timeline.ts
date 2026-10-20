/** Server functions for issue and pull request timelines. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { threadPageSchema } from "#/lib/thread-page";
import { readWithAccess } from "./repo-access";
import { listTimeline } from "./timeline-store";

/** Thread `#number`'s events (closed, reopened, merged, mentions), oldest first, one page. */
export const getTimeline = createServerFn({ method: "GET" })
	.validator(
		z
			.object({ repoId: z.number(), number: z.number().int().min(1) })
			.and(threadPageSchema),
	)
	.handler(({ data }) =>
		readWithAccess(`getTimeline #${data.number}`, data.repoId, () =>
			listTimeline(data.repoId, data.number, {
				limit: data.limit,
				offset: data.skip,
			}),
		),
	);
