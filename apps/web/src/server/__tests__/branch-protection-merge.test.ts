/**
 * @vitest-environment node
 *
 * A branch rule's required reviews, code owners and status checks drive the
 * merge: `mergeStateStatus` and `reviewDecision` report why, the merge is
 * refused until the head satisfies them, and a strict rule marks a head behind
 * its base as BEHIND. Dismissing stale reviews drops an approval once the head
 * moves.
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
const users = await createUsers("alice", "bob", "carol");
const { asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);
const { graphql } = await import("../../test/graphql-client");
const { addCollaboratorByUsername } = await import("../repositories");
const reviews = await import("../reviews");
const { findPullRequestByNumber } = await import("../thread-store");

const REPO = "proj";
const put = (token: string, body: unknown) => ({
	...asToken(token),
	method: "PUT",
	body: JSON.stringify(body),
});

let alice: string;
let repoId: number;

const protectionUrl = `/repos/alice/${REPO}/branches/main/protection`;
const pullsUrl = `/repos/alice/${REPO}/pulls`;

async function tip(branch: string): Promise<string> {
	const { body } = await call(`/repos/alice/${REPO}/git/ref/heads/${branch}`);
	return body.object.sha;
}

async function protect(body: unknown): Promise<void> {
	const { status } = await call(protectionUrl, put(alice, body));
	expect(status).toBe(200);
}

async function branch(name: string): Promise<void> {
	const { status } = await call(
		`/repos/alice/${REPO}/git/refs`,
		post(alice, { ref: `refs/heads/${name}`, sha: await tip("main") }),
	);
	expect(status).toBe(201);
}

/** Commits a new file on `name` through the contents API and returns its blob. */
async function commit(name: string, path: string): Promise<void> {
	const { status } = await call(
		`/repos/alice/${REPO}/contents/${path}`,
		put(alice, {
			message: `add ${path}`,
			content: Buffer.from(`${path}\n`).toString("base64"),
			branch: name,
		}),
	);
	expect(status).toBe(201);
}

async function open(head: string, title: string): Promise<number> {
	const { status, body } = await call(
		pullsUrl,
		post(alice, { title, head, base: "main" }),
	);
	expect(status).toBe(201);
	return body.number;
}

async function status(sha: string, context: string): Promise<void> {
	const { status: code } = await call(
		`/repos/alice/${REPO}/statuses/${sha}`,
		post(alice, { state: "success", context }),
	);
	expect(code).toBe(201);
}

async function approve(number: number, user = users.bob): Promise<void> {
	const pr = await findPullRequestByNumber(repoId, number);
	if (!pr) throw new Error(`pull request ${number} missing`);
	signIn(user);
	await reviews.submitReview({ data: { prId: pr.id, event: "approve" } });
	signIn(users.alice);
}

const merge = (number: number) =>
	call(`${pullsUrl}/${number}/merge`, put(alice, {}));

const pullNumber = async (number: number) => {
	const { body } = await graphql(
		alice,
		`query($number: Int!) { repository(owner:"alice",name:"proj") {
			pullRequest(number:$number) { mergeStateStatus reviewDecision }
		} }`,
		{ number },
	);
	expect(body.errors).toBeUndefined();
	return body.data.repository.pullRequest;
};

const mergeableState = async (number: number) => {
	const { body } = await call(`${pullsUrl}/${number}`);
	return body.mergeable_state;
};

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	await call("/user/repos", post(alice, { name: REPO, auto_init: true }));
	const { findRepositoryByName } = await import("../repository-lookup");
	const repository = await findRepositoryByName("alice", REPO);
	if (!repository) throw new Error("fixture repository missing");
	repoId = repository.id;
	signIn(users.alice);
	await addCollaboratorByUsername({
		data: { repoId, username: "bob", role: "write" },
	});
	await addCollaboratorByUsername({
		data: { repoId, username: "carol", role: "write" },
	});
});

describe("code owner reviews", () => {
	it("requires the approval of a code owner of the changed paths", async () => {
		const { status: code } = await call(
			`/repos/alice/${REPO}/contents/.github/CODEOWNERS`,
			put(alice, {
				message: "add CODEOWNERS",
				content: Buffer.from("* @carol\n").toString("base64"),
				branch: "main",
			}),
		);
		expect(code).toBe(201);
		await branch("owned");
		await commit("owned", "owned.txt");
		const number = await open("owned", "Owned");
		await protect({
			required_pull_request_reviews: {
				required_approving_review_count: 1,
				require_code_owner_reviews: true,
			},
			enforce_admins: true,
		});

		await approve(number);
		expect(await pullNumber(number)).toEqual({
			mergeStateStatus: "BLOCKED",
			reviewDecision: "REVIEW_REQUIRED",
		});

		await approve(number, users.carol);
		expect((await pullNumber(number)).reviewDecision).toBe("APPROVED");
		expect((await merge(number)).status).toBe(200);
	});
});

describe("required reviews and status checks", () => {
	it("blocks the merge until an approval and the required check pass", async () => {
		await branch("reviewed");
		await commit("reviewed", "note.txt");
		const number = await open("reviewed", "Reviewed");

		await protect({
			required_pull_request_reviews: { required_approving_review_count: 1 },
			required_status_checks: { strict: false, contexts: ["ci"] },
			enforce_admins: true,
		});

		expect(await pullNumber(number)).toEqual({
			mergeStateStatus: "BLOCKED",
			reviewDecision: "REVIEW_REQUIRED",
		});
		expect(await mergeableState(number)).toBe("blocked");

		const head = await tip("reviewed");
		const refused = await merge(number);
		expect(refused.status).toBe(405);
		expect(await tip("main")).not.toBe(head);

		await approve(number);
		expect((await pullNumber(number)).reviewDecision).toBe("APPROVED");
		// Pending: the required `ci` context has reported nothing yet.
		expect(await pullNumber(number)).toEqual({
			mergeStateStatus: "UNSTABLE",
			reviewDecision: "APPROVED",
		});

		await status(await tip("reviewed"), "ci");
		expect(await pullNumber(number)).toEqual({
			mergeStateStatus: "CLEAN",
			reviewDecision: "APPROVED",
		});

		expect((await merge(number)).status).toBe(200);
	});
});

describe("strict status checks", () => {
	it("marks a head behind its base as BEHIND and refuses until it is merged up", async () => {
		await protect({
			required_status_checks: { strict: true, contexts: [] },
			enforce_admins: true,
		});
		await branch("behind");
		await commit("behind", "behind.txt");
		const number = await open("behind", "Behind");
		expect((await pullNumber(number)).mergeStateStatus).toBe("CLEAN");
		const { body } = await graphql(
			alice,
			`query { repository(owner:"alice",name:"proj") {
				pullRequest(number:${number}) {
					baseRef { branchProtectionRule { requiresStrictStatusChecks } }
				}
			} }`,
		);
		expect(body.errors).toBeUndefined();
		expect(
			body.data.repository.pullRequest.baseRef.branchProtectionRule,
		).toEqual({ requiresStrictStatusChecks: true });

		// The rule requires no pull request, so the base may be written directly.
		await commit("main", "advance.txt");
		expect((await pullNumber(number)).mergeStateStatus).toBe("BEHIND");
		expect((await merge(number)).status).toBe(405);

		const { mergeBranches } = await import("../git-write");
		const merged = await mergeBranches("alice", REPO, "main", "behind", {
			method: "merge",
			message: "Merge main into behind",
		});
		expect(merged.success).toBe(true);
		expect((await pullNumber(number)).mergeStateStatus).toBe("CLEAN");
		expect((await merge(number)).status).toBe(200);
	});
});

describe("dismiss stale reviews", () => {
	it("drops an approval given on an earlier head", async () => {
		await protect({
			required_pull_request_reviews: {
				required_approving_review_count: 1,
				dismiss_stale_reviews: true,
			},
			enforce_admins: true,
		});
		await branch("stale");
		await commit("stale", "stale.txt");
		const number = await open("stale", "Stale");
		await approve(number);
		expect((await pullNumber(number)).reviewDecision).toBe("APPROVED");

		await commit("stale", "later.txt");
		expect(await pullNumber(number)).toEqual({
			mergeStateStatus: "BLOCKED",
			reviewDecision: "REVIEW_REQUIRED",
		});
		expect((await merge(number)).status).toBe(405);
	});
});
