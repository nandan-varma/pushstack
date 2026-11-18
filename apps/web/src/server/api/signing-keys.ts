/**
 * `/api/v3` user signing keys: `users/*-gpg-key*` and `users/*-ssh-signing-key*`.
 * Every handler is scoped to the token's owner — there is no route to another
 * user's keys, as on GitHub.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import { clearVerificationCache } from "../commit-verification";
import {
	createGpgKey,
	createSshSigningKey,
	deleteGpgKey,
	deleteSshSigningKey,
	getGpgKey,
	getSshSigningKey,
	listGpgKeys,
	listSshSigningKeys,
} from "../signing-key-store";
import { type ApiContext, requireCaller, requireScope } from "./auth";
import { json, noContent } from "./http";
import { pathParams, requestBody } from "./input";

/** The caller's account email, when it is verified (GitHub's key owner check). */
async function verifiedEmail(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ email: user.email, verified: user.emailVerified })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!row) return null;
	return row.verified ? row.email : null;
}

export async function listGpgKeysForCaller(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	return json(await listGpgKeys(userId, await verifiedEmail(userId)));
}

export async function createGpgKeyForCaller(ctx: ApiContext) {
	const { userId } = requireScope(ctx, "repo:write");
	const body = await requestBody(
		ctx,
		"users/create-gpg-key-for-authenticated-user",
		"GpgKey",
	);
	const key = await createGpgKey(
		userId,
		body.armored_public_key,
		await verifiedEmail(userId),
	);
	clearVerificationCache();
	return json(key, 201);
}

export async function getGpgKeyForCaller(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	const { gpg_key_id: id } = pathParams(
		ctx,
		"users/get-gpg-key-for-authenticated-user",
	);
	return json(await getGpgKey(userId, id, await verifiedEmail(userId)));
}

export async function deleteGpgKeyForCaller(ctx: ApiContext) {
	const { userId } = requireScope(ctx, "repo:write");
	const { gpg_key_id: id } = pathParams(
		ctx,
		"users/delete-gpg-key-for-authenticated-user",
	);
	await deleteGpgKey(userId, id);
	clearVerificationCache();
	return noContent();
}

export async function listSshSigningKeysForCaller(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	return json(await listSshSigningKeys(userId));
}

export async function createSshSigningKeyForCaller(ctx: ApiContext) {
	const { userId } = requireScope(ctx, "repo:write");
	const body = await requestBody(
		ctx,
		"users/create-ssh-signing-key-for-authenticated-user",
		"SshSigningKey",
	);
	const key = await createSshSigningKey(
		userId,
		body.title ?? "Signing key",
		body.key,
	);
	clearVerificationCache();
	return json(key, 201);
}

export async function getSshSigningKeyForCaller(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	const { ssh_signing_key_id: id } = pathParams(
		ctx,
		"users/get-ssh-signing-key-for-authenticated-user",
	);
	return json(await getSshSigningKey(userId, id));
}

export async function deleteSshSigningKeyForCaller(ctx: ApiContext) {
	const { userId } = requireScope(ctx, "repo:write");
	const { ssh_signing_key_id: id } = pathParams(
		ctx,
		"users/delete-ssh-signing-key-for-authenticated-user",
	);
	await deleteSshSigningKey(userId, id);
	clearVerificationCache();
	return noContent();
}
