/**
 * One-off fixture setup for local performance profiling (not part of the
 * app). Creates a test user, a PAT for git CLI auth, and an empty
 * repository via the real initBareRepo path (writes straight to R2/local
 * disk per isR2Configured(), same as createRepository's handler does).
 * Prints the PAT and clone URL. Safe to re-run — clears prior perf-test
 * fixtures first.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { repositories, tokens } from "#/db/app-schema";
import { user } from "#/db/schema";
import { initBareRepo } from "#/server/git-manager-iso";
import { getStorageOwnerKey } from "#/server/git-storage-naming";

const USER_ID = "perf-test-user";
const USERNAME = "perfuser";
const EMAIL = "perfuser@example.com";
const REPO_NAME = "perf-repo";

async function main() {
	await db.delete(repositories).where(eq(repositories.ownerId, USER_ID));
	await db.delete(tokens).where(eq(tokens.userId, USER_ID));
	await db.delete(user).where(eq(user.id, USER_ID));

	const now = new Date();
	await db.insert(user).values({
		id: USER_ID,
		name: "Perf Test User",
		email: EMAIL,
		emailVerified: true,
		username: USERNAME,
		createdAt: now,
		updatedAt: now,
	});

	const pat = `ghp_${crypto.randomBytes(24).toString("hex")}`;
	const tokenHash = crypto.createHash("sha256").update(pat).digest("hex");
	await db.insert(tokens).values({
		userId: USER_ID,
		name: "perf-test-token",
		tokenHash,
		scopes: ["repo"],
	});

	const ownerKey = getStorageOwnerKey({
		id: USER_ID,
		username: USERNAME,
		email: EMAIL,
	});
	const gitPath = await initBareRepo(ownerKey, REPO_NAME);
	await db.insert(repositories).values({
		ownerId: USER_ID,
		name: REPO_NAME,
		visibility: "public",
		defaultBranch: "main",
		gitPath,
	});

	console.log("PAT:", pat);
	console.log(
		"CLONE_URL:",
		`http://${USERNAME}:${pat}@localhost:3000/api/git/${USERNAME}/${REPO_NAME}.git`,
	);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
