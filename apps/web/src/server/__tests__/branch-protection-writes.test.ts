/**
 * @vitest-environment node
 *
 * Branch protection blocks direct writes and merges: a rule that requires a
 * pull request refuses `PUT`/`DELETE …/contents` and deleting the branch with
 * GitHub's 422, and required approvals refuse the merge with 405 without
 * moving a ref.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);
const { addCollaboratorByUsername } = await import("../repositories");

const put = (token: string, body: unknown) => ({
	...asToken(token),
	method: "PUT",
	body: JSON.stringify(body),
});
const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

const REPO = "proj";
let alice: string;
let repoId: number;

const protection = (branch: string) =>
	`/repos/alice/${REPO}/branches/${branch}/protection`;
const refPath = (branch: string) =>
	`/repos/alice/${REPO}/git/ref/heads/${branch}`;

async function tip(branch: string): Promise<string> {
	const { body } = await call(refPath(branch));
	return body.object.sha;
}

async function protect(branch: string, approvals: number): Promise<void> {
	const { status } = await call(
		protection(branch),
		put(alice, {
			required_pull_request_reviews: {
				required_approving_review_count: approvals,
			},
			enforce_admins: true,
		}),
	);
	expect(status).toBe(200);
}

const file = (branch: string) => ({
	message: "add note",
	content: Buffer.from("note\n").toString("base64"),
	branch,
});

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	expect(
		(await call("/user/repos", post(alice, { name: REPO, auto_init: true })))
			.status,
	).toBe(201);
	const { findRepositoryByName } = await import("../repository-lookup");
	const repository = await findRepositoryByName("alice", REPO);
	if (!repository) throw new Error("fixture repository missing");
	repoId = repository.id;
	signIn(users.alice);
	await addCollaboratorByUsername({
		data: { repoId, username: "bob", role: "write" },
	});
	const main = await tip("main");
	expect(
		(
			await call(
				`/repos/alice/${REPO}/git/refs`,
				post(alice, { ref: "refs/heads/feature", sha: main }),
			)
		).status,
	).toBe(201);
	await protect("main", 0);
});

describe("direct writes", () => {
	it("refuses a contents write to a protected branch and leaves the tip", async () => {
		const before = await tip("main");
		const { status, body } = await call(
			`/repos/alice/${REPO}/contents/note.txt`,
			put(alice, file("main")),
		);
		expect(status).toBe(422);
		expect(body.message).toBe("Changes must be made through a pull request.");
		expect(await tip("main")).toBe(before);
	});

	it("commits the same write on an unprotected branch", async () => {
		const before = await tip("feature");
		const { status } = await call(
			`/repos/alice/${REPO}/contents/note.txt`,
			put(alice, file("feature")),
		);
		expect(status).toBe(201);
		expect(await tip("feature")).not.toBe(before);
	});

	it("allows creating a protected branch but refuses deleting it", async () => {
		const feature = await tip("feature");
		expect(
			(
				await call(
					`/repos/alice/${REPO}/git/refs`,
					post(alice, { ref: "refs/heads/release", sha: feature }),
				)
			).status,
		).toBe(201);
		await protect("release", 0);
		const { status, body } = await call(
			`/repos/alice/${REPO}/git/refs/heads/release`,
			del(alice),
		);
		expect(status).toBe(422);
		expect(body.message).toBe("Cannot delete a protected branch");
		expect(await tip("release")).toBe(feature);
	});
});

describe("merges", () => {
	it("refuses a merge below the required approvals and moves no ref", async () => {
		const created = await call(
			`/repos/alice/${REPO}/pulls`,
			post(alice, { title: "Note", head: "feature", base: "main" }),
		);
		expect(created.status).toBe(201);
		await protect("main", 1);
		const before = await tip("main");

		const refused = await call(
			`/repos/alice/${REPO}/pulls/${created.body.number}/merge`,
			put(alice, {}),
		);
		expect(refused.status).toBe(405);
		expect(refused.body.message).toBe("Pull Request is not mergeable");
		expect(await tip("main")).toBe(before);

		const { findPullRequestByNumber } = await import("../thread-store");
		const pr = await findPullRequestByNumber(repoId, created.body.number);
		if (!pr) throw new Error("fixture pull request missing");
		const reviews = await import("../reviews");
		signIn(users.bob);
		await reviews.submitReview({ data: { prId: pr.id, event: "approve" } });
		const merged = await call(
			`/repos/alice/${REPO}/pulls/${created.body.number}/merge`,
			put(alice, {}),
		);
		expect(merged.status).toBe(200);
		expect(await tip("main")).not.toBe(before);
	});
});
