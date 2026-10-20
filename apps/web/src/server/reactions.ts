import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { REACTION_CONTENTS } from "#/lib/reactions";
import { findComment } from "./comment-store";
import {
	addReaction,
	listThreadReactions,
	type ReactionSubject,
	removeReaction,
} from "./reaction-store";
import { readWithAccess, requireParticipateAccess } from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import { findThreadByNumber } from "./thread-store";

/** Reaction rollups for issue/PR `#number` and each of its comments. */
export const getThreadReactions = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number(), number: z.number().int() }))
	.handler(({ data }) =>
		readWithAccess("getThreadReactions", data.repoId, async () => {
			const thread = await findThreadByNumber(data.repoId, data.number);
			if (!thread) throw notFound();
			const user = await getCurrentUserOptional();
			return listThreadReactions(thread.id, user?.id);
		}),
	);

/**
 * Add or remove the current user's reaction on `#number` or, with
 * `commentId`, one of its comments. Any signed-in user who can read the
 * repository may react, as on GitHub.
 */
export const toggleReaction = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			number: z.number().int(),
			commentId: z.number().int().optional(),
			content: z.enum(REACTION_CONTENTS),
			/** The desired end state; omit to flip the current one. */
			reacted: z.boolean().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		await requireParticipateAccess(data.repoId, user.id);
		const thread = await findThreadByNumber(data.repoId, data.number);
		if (!thread) throw notFound();
		const subject: ReactionSubject = { issueId: thread.id };
		if (data.commentId !== undefined) {
			const comment = await findComment(data.commentId);
			if (!comment || comment.issueId !== thread.id) throw notFound();
			subject.commentId = comment.id;
		}
		if (data.reacted === true) {
			await addReaction(subject, user.id, data.content);
			return { reacted: true };
		}
		const removed = await removeReaction(subject, user.id, data.content);
		if (removed || data.reacted === false) return { reacted: false };
		await addReaction(subject, user.id, data.content);
		return { reacted: true };
	});
