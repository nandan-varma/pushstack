import crypto from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { tokens } from "#/db/app-schema";
import { TOKEN_PREFIX, TOKEN_SCOPES } from "#/lib/token-scopes";
import { perfContext, perfStep } from "./perf-log";
import { getCurrentUser } from "./session";

const DAY_MS = 24 * 60 * 60 * 1000;

/** SHA-256 hex, the only form a token is stored in (see git-auth.ts). */
export function hashToken(token: string): string {
	return crypto.createHash("sha256").update(token).digest("hex");
}

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
			name: z.string().trim().min(1).max(100),
			scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
			/** Days until expiry; `null` never expires. */
			lifetimeDays: z.number().int().min(1).max(365).nullable(),
		}),
	)
	.handler(({ data }) =>
		perfContext("createToken", async () => {
			const user = await getCurrentUser();
			const token = `${TOKEN_PREFIX}${crypto.randomBytes(30).toString("base64url")}`;
			const [created] = await perfStep("db: tokens.insert", () =>
				db
					.insert(tokens)
					.values({
						userId: user.id,
						name: data.name,
						tokenHash: hashToken(token),
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
