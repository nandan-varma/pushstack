/**
 * @vitest-environment node
 *
 * Classic branch protection over the REST API: the rule matcher (oldest
 * matching `fnmatch` pattern wins), the protection object and its
 * sub-resources, and `protected` on branch JSON. Rules are inserted directly;
 * the write endpoints are a later issue.
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

const { createUsers } = await import("../../test/app-harness");
const users = await createUsers("alice");
const { BASE, asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);
const { db } = await import("../../db");
const { branchProtectionRules, branchProtectionStatusChecks, repositories } =
	await import("../../db/app-schema");
const { matchBranchPattern } = await import("../branch-protection-store");
const { eq } = await import("drizzle-orm");

let alice: string;

async function repoId(name: string): Promise<number> {
	const [row] = await db
		.select({ id: repositories.id })
		.from(repositories)
		.where(eq(repositories.name, name));
	if (!row) throw new Error(`no repository ${name}`);
	return row.id;
}

async function addRule(
	repo: string,
	values: Partial<typeof branchProtectionRules.$inferInsert> & {
		pattern: string;
	},
	contexts: { context: string; appId?: number }[] = [],
): Promise<void> {
	const [rule] = await db
		.insert(branchProtectionRules)
		.values({ repoId: await repoId(repo), ...values })
		.returning({ id: branchProtectionRules.id });
	if (!rule) throw new Error("rule insert returned no row");
	if (contexts.length > 0) {
		await db.insert(branchProtectionStatusChecks).values(
			contexts.map((check) => ({
				ruleId: rule.id,
				context: check.context,
				appId: check.appId ?? null,
			})),
		);
	}
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	for (const name of ["proj", "bare", "multi"]) {
		expect(
			(await call("/user/repos", post(alice, { name, auto_init: true })))
				.status,
		).toBe(201);
	}
	await addRule(
		"proj",
		{
			pattern: "main",
			requiresPullRequest: true,
			requiredApprovingReviewCount: 2,
			dismissStaleReviews: true,
			requireCodeOwnerReviews: true,
			requiredStatusChecksStrict: true,
			enforceAdmins: true,
		},
		[{ context: "ci/test", appId: 7 }, { context: "build" }],
	);
	// The older `m*` rule protects `main`; the later exact rule is shadowed.
	await addRule("multi", { pattern: "m*", allowDeletions: true });
	await addRule("multi", { pattern: "main", allowDeletions: false });
});

const protection = (repo: string, branch = "main") =>
	`/repos/alice/${repo}/branches/${branch}/protection`;

describe("the pattern matcher", () => {
	it("matches `*` and `?` and keeps every other character literal", () => {
		expect(matchBranchPattern("main", "main")).toBe(true);
		expect(matchBranchPattern("main", "mainline")).toBe(false);
		expect(matchBranchPattern("m*", "main")).toBe(true);
		expect(matchBranchPattern("release/*", "release/1.0")).toBe(true);
		expect(matchBranchPattern("v?", "v1")).toBe(true);
		expect(matchBranchPattern("v?", "v10")).toBe(false);
		expect(matchBranchPattern("a.b", "axb")).toBe(false);
		expect(matchBranchPattern("a.b", "a.b")).toBe(true);
		expect(matchBranchPattern("a+b", "a+b")).toBe(true);
		expect(matchBranchPattern("(x)+", "(x)+")).toBe(true);
		// A pattern longer than the write cap is never compiled.
		expect(matchBranchPattern("a".repeat(256), "a".repeat(256))).toBe(false);
	});
});

describe("an unprotected branch", () => {
	it("is a 404, and its branch JSON says protected: false", async () => {
		const response = await call(protection("bare"));
		expect(response.status).toBe(404);
		expect(response.body.message).toBe("Branch not protected");

		const branch = await call("/repos/alice/bare/branches/main");
		expect(branch.body.protected).toBe(false);
		const list = await call("/repos/alice/bare/branches");
		expect(
			list.body.map((item: { protected: boolean }) => item.protected),
		).toEqual([false]);
	});

	it("is a 404 for each sub-resource too", async () => {
		for (const path of [
			"required_status_checks",
			"required_status_checks/contexts",
			"required_pull_request_reviews",
			"enforce_admins",
			"allow_force_pushes",
			"allow_deletions",
		]) {
			const response = await call(`${protection("bare")}/${path}`);
			expect(response.status, path).toBe(404);
			expect(response.body.message, path).toBe("Branch not protected");
		}
	});

	it("needs only a token that can read the repository", async () => {
		expect((await call(protection("bare"))).status).toBe(404);
		expect((await call(protection("bare"), asToken(alice))).status).toBe(404);
	});
});

describe("a protected branch", () => {
	it("returns GitHub's protection object", async () => {
		const { status, body } = await call(protection("proj"));
		expect(status).toBe(200);
		expect(body).toEqual({
			url: `${BASE}/repos/alice/proj/branches/main/protection`,
			required_status_checks: {
				url: `${BASE}/repos/alice/proj/branches/main/protection/required_status_checks`,
				strict: true,
				contexts: ["build", "ci/test"],
				contexts_url: `${BASE}/repos/alice/proj/branches/main/protection/required_status_checks/contexts`,
				checks: [
					{ context: "build", app_id: null },
					{ context: "ci/test", app_id: 7 },
				],
			},
			required_pull_request_reviews: {
				url: `${BASE}/repos/alice/proj/branches/main/protection/required_pull_request_reviews`,
				dismissal_restrictions: { users: [], teams: [], apps: [] },
				dismiss_stale_reviews: true,
				require_code_owner_reviews: true,
				required_approving_review_count: 2,
				bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
			},
			required_signatures: { enabled: false },
			enforce_admins: {
				url: `${BASE}/repos/alice/proj/branches/main/protection/enforce_admins`,
				enabled: true,
			},
			required_linear_history: { enabled: false },
			allow_force_pushes: {
				url: `${BASE}/repos/alice/proj/branches/main/protection/allow_force_pushes`,
				enabled: false,
			},
			allow_deletions: {
				url: `${BASE}/repos/alice/proj/branches/main/protection/allow_deletions`,
				enabled: false,
			},
			block_creations: { enabled: false },
			required_conversation_resolution: { enabled: false },
			lock_branch: { enabled: false },
			allow_fork_syncing: { enabled: false },
		});
	});

	it("serves each sub-resource", async () => {
		const statusChecks = await call(
			`${protection("proj")}/required_status_checks`,
		);
		expect(statusChecks.body.contexts).toEqual(["build", "ci/test"]);

		const contexts = await call(
			`${protection("proj")}/required_status_checks/contexts`,
		);
		expect(contexts.body).toEqual(["build", "ci/test"]);

		const reviews = await call(
			`${protection("proj")}/required_pull_request_reviews`,
		);
		expect(reviews.body.required_approving_review_count).toBe(2);

		const admins = await call(`${protection("proj")}/enforce_admins`);
		expect(admins.body).toEqual({
			url: `${BASE}/repos/alice/proj/branches/main/protection/enforce_admins`,
			enabled: true,
		});

		const forcePush = await call(`${protection("proj")}/allow_force_pushes`);
		expect(forcePush.body.enabled).toBe(false);
		const deletions = await call(`${protection("proj")}/allow_deletions`);
		expect(deletions.body.enabled).toBe(false);
	});

	it("says protected: true on the branch and the branch list", async () => {
		const branch = await call("/repos/alice/proj/branches/main");
		expect(branch.body.protected).toBe(true);
		const list = await call("/repos/alice/proj/branches");
		expect(
			list.body.map((item: { name: string; protected: boolean }) => [
				item.name,
				item.protected,
			]),
		).toEqual([["main", true]]);
	});

	it("is 404 for a sub-resource the rule does not enable", async () => {
		const statusChecks = await call(
			`${protection("multi")}/required_status_checks`,
		);
		expect(statusChecks.status).toBe(404);
		expect(statusChecks.body.message).toBe(
			"Required status checks not enabled",
		);
		const reviews = await call(
			`${protection("multi")}/required_pull_request_reviews`,
		);
		expect(reviews.status).toBe(404);
		expect(reviews.body.message).toBe(
			"Required pull request reviews not enabled",
		);
	});

	it("lets the oldest matching rule win", async () => {
		const { body } = await call(protection("multi"));
		// `m*` was added first, so its allow_deletions applies, not `main`'s.
		expect(body.allow_deletions.enabled).toBe(true);
		expect(body.required_status_checks).toBeNull();
		expect(body.required_pull_request_reviews).toBeNull();
	});

	it("does not protect a branch the pattern does not match", async () => {
		expect((await call(protection("proj", "feature/x"))).status).toBe(404);
	});
});
