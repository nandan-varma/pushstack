import { eq } from "drizzle-orm";
import { db } from "#/db";
import { repositories, tokens } from "#/db/app-schema";
import { user } from "#/db/schema";
import { bytesToBase64Url, randomBytes } from "#/lib/bytes";
import { hashToken, TOKEN_PREFIX } from "#/lib/token-scopes";
import { initBareRepo } from "#/server/git-repo";

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

	const pat = `${TOKEN_PREFIX}${bytesToBase64Url(randomBytes(30))}`;
	const tokenHash = await hashToken(pat);
	await db.insert(tokens).values({
		userId: USER_ID,
		name: "perf-test-token",
		tokenHash,
		scopes: ["repo:write"],
	});

	await initBareRepo(USERNAME, REPO_NAME, "main");
	await db.insert(repositories).values({
		ownerId: USER_ID,
		name: REPO_NAME,
		visibility: "public",
		defaultBranch: "main",
	});

	console.log("PAT:", pat);
	console.log(
		"CLONE_URL:",
		`http://${USERNAME}:${pat}@localhost:3000/${USERNAME}/${REPO_NAME}.git`,
	);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
