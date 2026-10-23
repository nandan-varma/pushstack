/**
 * @vitest-environment node
 *
 * Commit statuses and the checks API at `/api/v3`: what an external CI
 * reports, the combined status, check run rules, suites, permissions and
 * limits.
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

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const commitChecks = await import("../commit-checks");
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);

const users = await createUsers("alice", "bob");

let alice: string;
let aliceRead: string;
let bob: string;
let head: string;
const status = (sha: string, token: string, body: unknown) =>
	call(`/repos/alice/proj/statuses/${sha}`, post(token, body));

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	aliceRead = await mintToken(users.alice, ["repo:read"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	await call("/user/repos", post(alice, { name: "secret", private: true }));
	head = (await call("/repos/alice/proj/commits")).body[0].sha;
});

describe("commit statuses", () => {
	it("creates a status with GitHub's shape and Location", async () => {
		const {
			status: code,
			headers,
			body,
		} = await status(head, alice, {
			state: "pending",
			context: "ci/build",
			description: "Running",
			target_url: "https://ci.example/1",
		});
		expect(code).toBe(201);
		expect(headers.get("location")).toMatch(
			new RegExp(`/repos/alice/proj/statuses/${head}$`),
		);
		expect(body).toMatchObject({
			state: "pending",
			context: "ci/build",
			description: "Running",
			target_url: "https://ci.example/1",
			creator: { login: "alice" },
		});
	});

	it("defaults the context and accepts a branch name or abbreviated sha", async () => {
		const { status: code, body } = await status(head.slice(0, 10), alice, {
			state: "success",
		});
		expect(code).toBe(201);
		expect(body.context).toBe("default");
		expect(body.target_url).toBeNull();
	});

	it("combines the newest status of each context", async () => {
		await status(head, alice, { state: "success", context: "ci/build" });
		await status(head, alice, { state: "failure", context: "ci/lint" });
		const { body } = await call(`/repos/alice/proj/commits/main/status`);
		expect(body).toMatchObject({ state: "failure", sha: head, total_count: 3 });
		expect(
			body.statuses.map((s: { context: string; state: string }) => [
				s.context,
				s.state,
			]),
		).toEqual([
			["ci/build", "success"],
			["ci/lint", "failure"],
			["default", "success"],
		]);
		expect(body.repository.full_name).toBe("alice/proj");

		await status(head, alice, { state: "success", context: "ci/lint" });
		const again = await call(`/repos/alice/proj/commits/${head}/status`);
		expect(again.body.state).toBe("success");
	});

	it("is pending with no statuses, and pending beats success", async () => {
		const first = (await call("/repos/alice/proj/commits?per_page=1&sha=main"))
			.body[0].sha;
		expect(first).toBe(head);
		await status(head, alice, { state: "pending", context: "ci/slow" });
		expect(
			(await call(`/repos/alice/proj/commits/${head}/status`)).body.state,
		).toBe("pending");
	});

	it("lists every status newest first with pagination", async () => {
		const { body, headers } = await call(
			`/repos/alice/proj/commits/${head}/statuses?per_page=2`,
		);
		expect(body).toHaveLength(2);
		expect(body[0].id).toBeGreaterThan(body[1].id);
		expect(headers.get("link")).toContain('rel="next"');
	});

	it("rejects bad input and unknown commits", async () => {
		expect((await status(head, alice, { state: "nope" })).status).toBe(422);
		expect(
			(
				await status(head, alice, {
					state: "success",
					target_url: "javascript:1",
				})
			).status,
		).toBe(422);
		expect(
			(await status("0".repeat(40), alice, { state: "success" })).status,
		).toBe(422);
	});

	it("needs write access and the repo:write scope", async () => {
		expect((await status(head, aliceRead, { state: "success" })).status).toBe(
			403,
		);
		expect((await status(head, bob, { state: "success" })).status).toBe(403);
		expect(
			(
				await call(`/repos/alice/proj/statuses/${head}`, {
					method: "POST",
					body: "{}",
				})
			).status,
		).toBe(401);
	});

	it("hides a private repository's statuses from others", async () => {
		const secretHead = (
			await call("/repos/alice/secret/commits", asToken(alice))
		).status;
		// An empty private repository has no commits to report on.
		expect(secretHead).toBe(409);
		expect(
			(await call(`/repos/alice/secret/commits/main/status`, asToken(bob)))
				.status,
		).toBe(404);
	});

	it("caps statuses per commit and context", async () => {
		const { db } = await import("#/db");
		const { commitStatuses } = await import("#/db/app-schema");
		const repo = (await call("/repos/alice/proj")).body;
		await db.insert(commitStatuses).values(
			Array.from({ length: 1000 }, () => ({
				repoId: repo.id,
				sha: head,
				context: "ci/flood",
				state: "success" as const,
				creatorId: users.alice.id,
			})),
		);
		const res = await status(head, alice, {
			state: "success",
			context: "ci/flood",
		});
		expect(res.status).toBe(422);
		expect(res.body.errors[0].message).toMatch(/maximum number of statuses/);
	});
});

describe("check runs", () => {
	let runId: number;
	let suiteId: number;

	it("creates a queued run on the commit's suite", async () => {
		const { status: code, body } = await call(
			"/repos/alice/proj/check-runs",
			post(alice, {
				name: "build",
				head_sha: head,
				external_id: "run-1",
				details_url: "https://ci.example/runs/1",
				output: { title: "Queued", summary: "Waiting" },
			}),
		);
		expect(code).toBe(201);
		runId = body.id;
		suiteId = body.check_suite.id;
		expect(body).toMatchObject({
			name: "build",
			head_sha: head,
			status: "queued",
			conclusion: null,
			external_id: "run-1",
			output: { title: "Queued", summary: "Waiting", annotations_count: 0 },
		});
	});

	it("updates to in progress and then completes with a conclusion", async () => {
		const path = `/repos/alice/proj/check-runs/${runId}`;
		const started = await call(
			path,
			patch(alice, {
				status: "in_progress",
				started_at: "2026-01-01T00:00:00Z",
			}),
		);
		expect(started.body).toMatchObject({
			status: "in_progress",
			started_at: "2026-01-01T00:00:00Z",
		});
		const done = await call(path, patch(alice, { conclusion: "failure" }));
		expect(done.body).toMatchObject({
			status: "completed",
			conclusion: "failure",
			output: { title: "Queued" },
		});
		expect(done.body.completed_at).toEqual(expect.any(String));
		expect((await call(path)).body.conclusion).toBe("failure");
	});

	it("enforces the status and conclusion rules", async () => {
		const path = `/repos/alice/proj/check-runs/${runId}`;
		expect((await call(path, patch(alice, { status: "queued" }))).status).toBe(
			422,
		);
		const create = (body: unknown) =>
			call("/repos/alice/proj/check-runs", post(alice, body));
		expect(
			(await create({ name: "x", head_sha: head, status: "completed" })).status,
		).toBe(422);
		expect(
			(
				await create({
					name: "x",
					head_sha: head,
					status: "queued",
					conclusion: "success",
				})
			).status,
		).toBe(422);
		expect((await create({ name: "x", head_sha: "f".repeat(40) })).status).toBe(
			422,
		);
		expect((await create({ head_sha: head })).status).toBe(422);
	});

	it("lists the latest run per name unless asked for all", async () => {
		await call(
			"/repos/alice/proj/check-runs",
			post(alice, {
				name: "build",
				head_sha: head,
				status: "completed",
				conclusion: "success",
			}),
		);
		await call(
			"/repos/alice/proj/check-runs",
			post(alice, { name: "lint", head_sha: head, status: "in_progress" }),
		);
		const latest = await call(`/repos/alice/proj/commits/${head}/check-runs`);
		expect(latest.body.total_count).toBe(2);
		expect(
			latest.body.check_runs.map((r: { name: string }) => r.name).sort(),
		).toEqual(["build", "lint"]);
		const all = await call(
			`/repos/alice/proj/commits/${head}/check-runs?filter=all`,
		);
		expect(all.body.total_count).toBe(3);
		const named = await call(
			`/repos/alice/proj/commits/${head}/check-runs?check_name=lint&status=in_progress`,
		);
		expect(named.body.total_count).toBe(1);
	});

	it("computes the suite's status and conclusion from its runs", async () => {
		const suite = await call(`/repos/alice/proj/check-suites/${suiteId}`);
		expect(suite.body).toMatchObject({
			head_sha: head,
			status: "in_progress",
			conclusion: null,
			latest_check_runs_count: 2,
			repository: { full_name: "alice/proj" },
		});
		const runs = await call(
			`/repos/alice/proj/check-suites/${suiteId}/check-runs`,
		);
		expect(runs.body.total_count).toBe(2);
		const list = await call(`/repos/alice/proj/commits/${head}/check-suites`);
		expect(list.body.total_count).toBe(1);
		expect(list.body.check_suites[0].id).toBe(suiteId);
		const created = await call(
			"/repos/alice/proj/check-suites",
			post(alice, { head_sha: head }),
		);
		expect(created.body.id).toBe(suiteId);
	});

	it("needs write access and hides private repositories", async () => {
		expect(
			(
				await call(
					"/repos/alice/proj/check-runs",
					post(bob, { name: "x", head_sha: head }),
				)
			).status,
		).toBe(403);
		expect(
			(await call(`/repos/alice/proj/check-runs/${runId}`, patch(bob, {})))
				.status,
		).toBe(403);
		expect((await call("/repos/alice/proj/check-runs/99999")).status).toBe(404);
		expect(
			(
				await call(
					"/repos/alice/secret/check-runs",
					post(bob, { name: "x", head_sha: head }),
				)
			).status,
		).toBe(404);
	});
});

describe("web rollups", () => {
	it("rolls statuses and check runs into one state per commit", async () => {
		signIn(users.alice);
		const repo = (await call("/repos/alice/proj")).body;
		const second = await call(
			"/repos/alice/proj/git/commits",
			post(alice, {
				message: "second",
				tree: (await call(`/repos/alice/proj/git/commits/${head}`)).body.tree
					.sha,
				parents: [head],
			}),
		);
		await call(
			"/repos/alice/proj/git/refs",
			post(alice, { ref: "refs/heads/other", sha: second.body.sha }),
		);
		const rollups = (shas: string[]) =>
			commitChecks.getCommitRollups({ data: { repoId: repo.id, shas } });
		expect(await rollups([second.body.sha])).toEqual({});
		// `head`: the newest `build` run passed but `lint` is still running.
		expect(await rollups([head, second.body.sha])).toEqual({
			[head]: "pending",
		});

		await call(
			`/repos/alice/proj/statuses/${second.body.sha}`,
			post(alice, { state: "success", context: "ci" }),
		);
		expect(await rollups([second.body.sha])).toEqual({
			[second.body.sha]: "success",
		});
		await call(
			"/repos/alice/proj/check-runs",
			post(alice, { name: "e2e", head_sha: second.body.sha }),
		);
		const checks = await commitChecks.getCommitChecks({
			data: { repoId: repo.id, rev: "other" },
		});
		expect(checks).toMatchObject({ sha: second.body.sha, state: "pending" });
		expect(checks.statuses).toHaveLength(1);
		expect(checks.runs.map((r) => r.name)).toEqual(["e2e"]);
		signOut();
	});
});
