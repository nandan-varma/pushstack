/**
 * @vitest-environment node
 *
 * The branch protection write endpoints: `PUT` creates or replaces a rule,
 * `DELETE` removes it, and each sub-resource rewrites one part of it. Writes
 * are admin-only, address the rule whose pattern is exactly the branch path,
 * and the acceptance path is gh's:
 *
 *   gh api -X PUT …/protection -f required_status_checks[strict]=true \
 *     -f required_status_checks[contexts][]=ci
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
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { addCollaboratorByUsername } = await import("../repositories");

const put = (token: string, body?: unknown) => ({
	...asToken(token),
	method: "PUT",
	body: body === undefined ? undefined : JSON.stringify(body),
});
const del = (token: string, body?: unknown) => ({
	...asToken(token),
	method: "DELETE",
	body: body === undefined ? undefined : JSON.stringify(body),
});

let alice: string;
let bob: string;

const protection = (repo = "proj", branch = "main") =>
	`/repos/alice/${repo}/branches/${branch}/protection`;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	for (const name of ["proj", "wild", "guarded"]) {
		expect(
			(await call("/user/repos", post(alice, { name, auto_init: true })))
				.status,
		).toBe(201);
	}
});

describe("PUT protection", () => {
	it("creates the rule the acceptance command sends, and GET round-trips it", async () => {
		const created = await call(
			protection(),
			put(alice, {
				required_status_checks: { strict: true, contexts: ["ci"] },
			}),
		);
		expect(created.status).toBe(200);
		expect(created.body.required_status_checks.strict).toBe(true);
		expect(created.body.required_status_checks.contexts).toEqual(["ci"]);
		// Everything the body left out is disabled, GitHub's full replace.
		expect(created.body.required_pull_request_reviews).toBeNull();
		expect(created.body.enforce_admins.enabled).toBe(false);
		expect(created.body.allow_force_pushes.enabled).toBe(false);
		expect(created.body.allow_deletions.enabled).toBe(false);

		const read = await call(protection());
		expect(read.status).toBe(200);
		expect(read.body).toEqual(created.body);
	});

	it("replaces the whole rule, and reads the same body back", async () => {
		const body = {
			required_status_checks: { strict: false, contexts: ["build", "ci"] },
			enforce_admins: true,
			required_pull_request_reviews: {
				dismiss_stale_reviews: true,
				require_code_owner_reviews: true,
				required_approving_review_count: 2,
			},
			allow_force_pushes: true,
			allow_deletions: true,
		};
		const written = await call(protection(), put(alice, body));
		expect(written.status).toBe(200);
		expect(written.body.required_status_checks.contexts).toEqual([
			"build",
			"ci",
		]);
		expect(
			written.body.required_pull_request_reviews
				.required_approving_review_count,
		).toBe(2);
		expect(written.body.enforce_admins.enabled).toBe(true);
		expect(written.body.allow_force_pushes.enabled).toBe(true);
		expect(written.body.allow_deletions.enabled).toBe(true);

		expect((await call(protection())).body).toEqual(written.body);
	});

	it("stores gh's form-encoded booleans and keeps one copy of a repeated context", async () => {
		const { status, body } = await call(
			protection("wild"),
			put(alice, {
				required_status_checks: { strict: "true", contexts: ["ci", "ci"] },
				enforce_admins: "true",
			}),
		);
		expect(status).toBe(200);
		expect(body.required_status_checks.strict).toBe(true);
		expect(body.required_status_checks.contexts).toEqual(["ci"]);
		expect(body.enforce_admins.enabled).toBe(true);
	});

	it("protects a wildcard pattern and reads it through a matching branch", async () => {
		expect(
			(await call(protection("wild", "release/*"), put(alice, {}))).status,
		).toBe(200);
		const read = await call(protection("wild", "release/1.0"));
		expect(read.status).toBe(200);
	});

	it("is 404 for an unsafe branch pattern", async () => {
		expect((await call(protection("proj", ".."), put(alice, {}))).status).toBe(
			404,
		);
	});
});

describe("the write sub-resources", () => {
	it("patches and removes the status checks", async () => {
		const patched = await call(
			`${protection()}/required_status_checks`,
			patch(alice, { strict: true, checks: [{ context: "ci", app_id: 7 }] }),
		);
		expect(patched.status).toBe(200);
		expect(patched.body.contexts).toEqual(["ci"]);
		expect(patched.body.checks).toEqual([{ context: "ci", app_id: 7 }]);

		expect(
			(await call(`${protection()}/required_status_checks`, del(alice))).status,
		).toBe(204);
		expect((await call(`${protection()}/required_status_checks`)).status).toBe(
			404,
		);
	});

	it("adds, replaces and removes contexts, returning the whole list", async () => {
		await call(
			`${protection()}/required_status_checks`,
			patch(alice, { strict: true, contexts: ["ci"] }),
		);
		const contexts = `${protection()}/required_status_checks/contexts`;

		const added = await call(contexts, post(alice, { contexts: ["build"] }));
		expect(added.body).toEqual(["build", "ci"]);
		// Adding a context twice keeps one.
		const again = await call(contexts, post(alice, { contexts: ["build"] }));
		expect(again.body).toEqual(["build", "ci"]);

		const replaced = await call(
			contexts,
			put(alice, { contexts: ["lint", "test"] }),
		);
		expect(replaced.body).toEqual(["lint", "test"]);

		const removed = await call(contexts, del(alice, { contexts: ["lint"] }));
		expect(removed.body).toEqual(["test"]);
	});

	it("patches and removes required reviews", async () => {
		const patched = await call(
			`${protection()}/required_pull_request_reviews`,
			patch(alice, { required_approving_review_count: 3 }),
		);
		expect(patched.status).toBe(200);
		expect(patched.body.required_approving_review_count).toBe(3);

		expect(
			(await call(`${protection()}/required_pull_request_reviews`, del(alice)))
				.status,
		).toBe(204);
		expect(
			(await call(`${protection()}/required_pull_request_reviews`)).status,
		).toBe(404);
	});

	it("is 422 for a 7th approving review", async () => {
		const response = await call(
			`${protection()}/required_pull_request_reviews`,
			patch(alice, { required_approving_review_count: 7 }),
		);
		expect(response.status).toBe(422);
		expect(response.body.errors[0].field).toBe(
			"required_approving_review_count",
		);
	});

	it("sets and clears each toggle", async () => {
		for (const name of [
			"enforce_admins",
			"allow_force_pushes",
			"allow_deletions",
		]) {
			const set = await call(`${protection()}/${name}`, {
				...asToken(alice),
				method: "POST",
			});
			expect(set.status, name).toBe(200);
			expect(set.body.enabled).toBe(true);
			expect((await call(`${protection()}/${name}`)).body.enabled).toBe(true);

			expect((await call(`${protection()}/${name}`, del(alice))).status).toBe(
				204,
			);
			expect((await call(`${protection()}/${name}`)).body.enabled).toBe(false);
		}
	});
});

describe("deleting protection", () => {
	it("is 204, then 404 twice", async () => {
		expect((await call(protection(), del(alice))).status).toBe(204);
		expect((await call(protection())).status).toBe(404);
		expect((await call(protection(), del(alice))).status).toBe(404);
	});
});

describe("the rule cap", () => {
	it("is 422 when a repository already holds 100 rules", async () => {
		const { db } = await import("../../db");
		const { repositories, branchProtectionRules } = await import(
			"../../db/app-schema"
		);
		const { eq } = await import("drizzle-orm");
		const [repo] = await db
			.select({ id: repositories.id })
			.from(repositories)
			.where(eq(repositories.name, "guarded"));
		if (!repo) throw new Error("no repository guarded");
		await db.insert(branchProtectionRules).values(
			Array.from({ length: 100 }, (_, index) => ({
				repoId: repo.id,
				pattern: `branch-${index}`,
			})),
		);
		const response = await call(protection("guarded", "other"), put(alice, {}));
		expect(response.status).toBe(422);
		expect(response.body.errors[0].message).toContain("at most 100");
	});
});

describe("access", () => {
	it("is 403 for a collaborator who may write but not administer", async () => {
		signIn(users.alice);
		await addCollaboratorByUsername({
			data: { repoId: 3, username: "bob", role: "write" },
		});
		const response = await call(protection("guarded"), put(bob, {}));
		expect(response.status).toBe(403);
		expect(response.body.message).toBe("Must have admin rights to Repository.");
	});
});
