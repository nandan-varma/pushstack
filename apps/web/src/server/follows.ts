import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "#/db";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { getCurrentUser } from "./session";
import {
	followUser,
	listFollowers,
	listFollowing,
	unfollowUser,
} from "./watch-store";

const usernameSchema = z.string().regex(STORAGE_NAME_RE);

async function findUserId(username: string): Promise<string> {
	const row = await db.query.user.findFirst({
		columns: { id: true },
		where: { username },
	});
	if (!row) throw notFound();
	return row.id;
}

export const setFollowing = createServerFn({ method: "POST" })
	.validator(z.object({ username: usernameSchema, follow: z.boolean() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const targetId = await findUserId(data.username);
		if (targetId === currentUser.id) {
			throw new Error("You cannot follow yourself.");
		}
		if (data.follow) await followUser(currentUser.id, targetId);
		else await unfollowUser(currentUser.id, targetId);
		return { following: data.follow };
	});

const PROFILE_LIST_LIMIT = 100;

/** The first people on a profile's followers or following tab (public fields only). */
export const listProfileConnections = createServerFn({ method: "GET" })
	.validator(
		z.object({
			username: usernameSchema,
			kind: z.enum(["followers", "following"]),
		}),
	)
	.handler(async ({ data }) => {
		const targetId = await findUserId(data.username);
		const page = { limit: PROFILE_LIST_LIMIT, offset: 0 };
		const { users, total } =
			data.kind === "followers"
				? await listFollowers(targetId, page)
				: await listFollowing(targetId, page);
		return {
			total,
			users: users.map((person) => ({
				username: person.username,
				name: person.name,
				image: person.image,
			})),
		};
	});
