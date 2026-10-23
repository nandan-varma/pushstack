import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canReadRepo } from "./repo-access";
import { getCurrentUser } from "./session";
import { deleteRepoSubscription, setRepoSubscription } from "./watch-store";

/** GitHub's three watch levels: participating (no row), all activity, ignore. */
const WATCH_LEVELS = ["participating", "all", "ignore"] as const;

export const setWatchLevel = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), level: z.enum(WATCH_LEVELS) }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		if (!(await canReadRepo(data.repoId, currentUser.id))) throw notFound();
		if (data.level === "participating") {
			await deleteRepoSubscription(data.repoId, currentUser.id);
		} else {
			await setRepoSubscription(
				data.repoId,
				currentUser.id,
				data.level === "ignore",
			);
		}
		return { level: data.level };
	});
