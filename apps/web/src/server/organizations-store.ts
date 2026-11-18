/**
 * Organizations as repository owners. Creation claims the org's login in the
 * `logins` registry in one transaction, so a case variant of a username (or of
 * another org) cannot become a second owner whose storage prefix collides.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { logins, type Organization, organizations } from "#/db/app-schema";
import {
	MAX_ORG_BLOG_CHARS,
	MAX_ORG_DESCRIPTION_CHARS,
	MAX_ORG_EMAIL_CHARS,
	MAX_ORG_LOCATION_CHARS,
	MAX_ORG_NAME_CHARS,
	MAX_ORG_TWITTER_CHARS,
	MAX_STORAGE_NAME_LENGTH,
} from "#/lib/limits";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { isUniqueViolation } from "./db-errors";

/** GitHub's answer (422) for an org name that is already taken. */
export class OrganizationLoginTakenError extends Error {
	constructor() {
		super("Name is already in use");
	}
}

export const createOrganizationInputSchema = z.object({
	login: z.string().max(MAX_STORAGE_NAME_LENGTH).regex(STORAGE_NAME_RE),
	name: z.string().trim().max(MAX_ORG_NAME_CHARS).optional(),
	description: z.string().trim().max(MAX_ORG_DESCRIPTION_CHARS).optional(),
	blog: z.string().trim().max(MAX_ORG_BLOG_CHARS).optional(),
	location: z.string().trim().max(MAX_ORG_LOCATION_CHARS).optional(),
	email: z.string().trim().max(MAX_ORG_EMAIL_CHARS).optional(),
	twitterUsername: z.string().trim().max(MAX_ORG_TWITTER_CHARS).optional(),
});
export type CreateOrganizationInput = z.infer<
	typeof createOrganizationInputSchema
>;

/** Case-insensitive, like every login: `Acme` and `acme` are the same org. */
export function getOrganizationByLogin(
	login: string,
): Promise<Organization | null> {
	if (!STORAGE_NAME_RE.test(login)) return Promise.resolve(null);
	return db
		.select()
		.from(organizations)
		.where(sql`lower(${organizations.login}) = ${login.toLowerCase()}`)
		.limit(1)
		.then(([row]) => row ?? null);
}

export async function createOrganization(
	input: CreateOrganizationInput,
): Promise<Organization> {
	const value = createOrganizationInputSchema.parse(input);
	try {
		return await db.transaction(async (tx) => {
			const [organization] = await tx
				.insert(organizations)
				.values({
					login: value.login,
					name: value.name ?? null,
					description: value.description ?? null,
					blog: value.blog ?? null,
					location: value.location ?? null,
					email: value.email ?? null,
					twitterUsername: value.twitterUsername ?? null,
				})
				.returning();
			if (!organization) throw new Error("Organization insert returned no row");
			await tx.insert(logins).values({
				login: organization.login,
				kind: "organization",
				refId: String(organization.id),
			});
			return organization;
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new OrganizationLoginTakenError();
		throw error;
	}
}
