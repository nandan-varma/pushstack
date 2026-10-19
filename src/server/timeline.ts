/** Server functions for issue and pull request timelines. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readWithAccess } from "./repo-access";
import { listTimeline } from "./timeline-store";

/** Thread `#number`'s events (closed, reopened, merged, mentions), oldest first. */
export const getTimeline = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number(), number: z.number().int().min(1) }))
	.handler(({ data }) =>
		readWithAccess(`getTimeline #${data.number}`, data.repoId, () =>
			listTimeline(data.repoId, data.number),
		),
	);
