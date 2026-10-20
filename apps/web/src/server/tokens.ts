import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { tokens } from "#/db/app-schema";
import { bytesToBase64Url, randomBytes } from "#/lib/bytes";
import { MAX_TOKEN_NAME_CHARS } from "#/lib/limits";
import { hashToken, TOKEN_PREFIX, TOKEN_SCOPES } from "#/lib/token-scopes";
import { perfContext, perfStep } from "./perf-log";
import { getCurrentUser } from "./session";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The signed-in user's tokens, newest first. Never includes token values. */
export const listTokens = createServerFn({ method: "GET" }).handler(() =>
	perfContext("listTokens", async () => {
		const user = await getCurrentUser();
		return perfStep("db: tokens.findMany", () =>
			db
				.select({
					id: tokens.id,
					name: tokens.name,
					scopes: tokens.scopes,
					lastUsedAt: tokens.lastUsedAt,
					expiresAt: tokens.expiresAt,
					createdAt: tokens.createdAt,
				})
				.from(tokens)
				.where(eq(tokens.userId, user.id))
				.orderBy(desc(tokens.createdAt)),
		);
	}),
);

/** Create a token; the returned `token` is shown once and never retrievable again. */
export const createToken = createServerFn({ method: "POST" })
	.validator(
		z.object({
			name: z.string().trim().min(1).max(MAX_TOKEN_NAME_CHARS),
			scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
			/** Days until expiry; `null` never expires. */
			lifetimeDays: z.number().int().min(1).max(365).nullable(),
		}),
	)
	.handler(({ data }) =>
		perfContext("createToken", async () => {
			const user = await getCurrentUser();
			const token = `${TOKEN_PREFIX}${bytesToBase64Url(randomBytes(30))}`;
			const tokenHash = await hashToken(token);
			const [created] = await perfStep("db: tokens.insert", () =>
				db
					.insert(tokens)
					.values({
						userId: user.id,
						name: data.name,
						tokenHash,
						scopes: [...new Set(data.scopes)],
						expiresAt:
							data.lifetimeDays === null
								? null
								: new Date(Date.now() + data.lifetimeDays * DAY_MS),
					})
					.returning({ id: tokens.id }),
			);
			return { id: created?.id, token };
		}),
	);

export const revokeToken = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.number().int() }))
	.handler(({ data }) =>
		perfContext("revokeToken", async () => {
			const user = await getCurrentUser();
			await perfStep("db: tokens.delete", () =>
				db
					.delete(tokens)
					.where(and(eq(tokens.id, data.id), eq(tokens.userId, user.id))),
			);
		}),
	);
