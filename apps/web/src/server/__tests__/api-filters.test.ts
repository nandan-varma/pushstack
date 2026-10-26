/**
 * @vitest-environment node
 *
 * GitHub's list filters and body fields over `/api/v3`, end to end (the real
 * dispatcher over pglite). A filter the server implements must shrink the
 * result; one it does not must be a 422 naming it, never a silent no-op.
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
const files = await import("../files");
const repositories = await import("../repositories");

const users = await createUsers("alice", "bob", "carol");
const { asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);

const PAST = "2000-01-01T00:00:00Z";
const FUTURE = "2999-01-01T00:00:00Z";

let alice: string;
let carol: string;

const numbersOf = (body: { number: number }[]) =>
	body.map((item) => item.number).sort((a, b) => a - b);

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);

	const created = await call(
		"/user/repos",
		post(alice, { name: "filters", auto_init: true }),
	);
	expect(created.status).toBe(201);
	const repoId: number = created.body.id;

	signIn(users.alice);
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "bob", role: "read" },
	});
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Second",
		},
	});
	await files.createBranch({ data: { repoId, name: "topic" } });
	await files.uploadFile({
		data: {
			repoId,
			branchName: "topic",
			path: "b.txt",
			content: btoa("b\n"),
			commitMessage: "Topic",
		},
	});

	// #1 by alice, #2 by carol mentioning bob, #3 a pull request by alice.
	expect(
		(
			await call(
				"/repos/alice/filters/issues",
				post(alice, { title: "Alice's issue" }),
			)
		).status,
	).toBe(201);
	expect(
		(
			await call(
				"/repos/alice/filters/issues",
				post(carol, { title: "Carol's issue", body: "cc @bob please look" }),
			)
		).status,
	).toBe(201);
	const pull = await call(
		"/repos/alice/filters/pulls",
		post(alice, { title: "Topic", head: "topic", base: "main" }),
	);
	expect(pull.status).toBe(201);
});

describe("GET /repos/{owner}/{repo}/issues filters", () => {
	const list = (query: string) =>
		call(`/repos/alice/filters/issues?state=all&${query}`, asToken(alice));

	it("creator keeps the issues one user opened", async () => {
		const { status, body } = await list("creator=carol");
		expect(status).toBe(200);
		expect(numbersOf(body)).toEqual([2]);
	});

	it("type=* and type=none match every issue (PushStack has no issue types)", async () => {
		expect(numbersOf((await list("type=*")).body)).toEqual([1, 2, 3]);
		expect(numbersOf((await list("type=none")).body)).toEqual([1, 2, 3]);
	});

	it("422s a named issue type, since none are served", async () => {
		for (const type of ["pr", "issue", "bug"]) {
			const { status, body } = await list(`type=${type}`);
			expect(status).toBe(422);
			expect(body.errors).toEqual([
				{ resource: "Issue", field: "type", code: "invalid", value: type },
			]);
		}
	});

	it("mentioned keeps the threads that mention the login", async () => {
		expect(numbersOf((await list("mentioned=bob")).body)).toEqual([2]);
		expect(numbersOf((await list("mentioned=alice")).body)).toEqual([]);
	});

	it("since keeps the threads updated at or after the time", async () => {
		expect(numbersOf((await list(`since=${PAST}`)).body)).toEqual([1, 2, 3]);
		expect((await list(`since=${FUTURE}`)).body).toEqual([]);
	});

	it("422s a value that is not one of GitHub's (type)", async () => {
		const { status, body } = await list("type=bogus");
		expect(status).toBe(422);
		expect(body.errors).toEqual([
			{ resource: "Issue", field: "type", code: "invalid", value: "bogus" },
		]);
	});

	it("422s a parameter PushStack does not implement, never ignores it", async () => {
		const { status, body } = await list("issue_field_values=x");
		expect(status).toBe(422);
		expect(body).toMatchObject({
			message: "Validation Failed",
			errors: [
				{
					field: "issue_field_values",
					code: "custom",
					message: "issue_field_values is not supported by PushStack",
				},
			],
		});
	});
});

describe("unsupported parameters and fields", () => {
	it("422s an unsupported query parameter on an endpoint with no other parsing", async () => {
		const { status, body } = await call(
			"/repos/alice/filters/branches?protected=true",
			asToken(alice),
		);
		expect(status).toBe(422);
		expect(body.errors).toEqual([
			expect.objectContaining({ field: "protected", code: "custom" }),
		]);
	});

	it("422s an unsupported check-run filter", async () => {
		const { status, body } = await call(
			"/repos/alice/filters/commits/main/check-runs?app_id=1",
			asToken(alice),
		);
		expect(status).toBe(422);
		expect(body.errors).toEqual([
			expect.objectContaining({ field: "app_id", code: "custom" }),
		]);
	});

	it("422s an unsupported repository setting on create and update", async () => {
		const created = await call(
			"/user/repos",
			post(alice, { name: "settings", allow_squash_merge: false }),
		);
		expect(created.status).toBe(422);
		expect(created.body.errors).toEqual([
			expect.objectContaining({
				field: "allow_squash_merge",
				code: "custom",
			}),
		]);
		const updated = await call("/repos/alice/filters", {
			...asToken(alice),
			method: "PATCH",
			body: JSON.stringify({ delete_branch_on_merge: true }),
		});
		expect(updated.status).toBe(422);
		expect(updated.body.errors).toEqual([
			expect.objectContaining({
				field: "delete_branch_on_merge",
				code: "custom",
			}),
		]);
	});

	it("422s an unsupported issue field and leaves the issue unchanged", async () => {
		const { status } = await call("/repos/alice/filters/issues/1", {
			...asToken(alice),
			method: "PATCH",
			body: JSON.stringify({ type: "bug" }),
		});
		expect(status).toBe(422);
		const issue = await call("/repos/alice/filters/issues/1", asToken(alice));
		expect(issue.body.title).toBe("Alice's issue");
	});

	it("422s an unsupported pull request field on create", async () => {
		const { status, body } = await call(
			"/repos/alice/filters/pulls",
			post(alice, {
				title: "Again",
				head: "topic",
				base: "main",
				maintainer_can_modify: true,
			}),
		);
		expect(status).toBe(422);
		expect(body.errors).toEqual([
			expect.objectContaining({
				field: "maintainer_can_modify",
				code: "custom",
			}),
		]);
	});
});

describe("the singular assignee", () => {
	it("assigns on create and clears on update with null", async () => {
		const created = await call(
			"/repos/alice/filters/issues",
			post(alice, { title: "Assigned", assignee: "alice" }),
		);
		expect(created.status).toBe(201);
		expect(created.body.assignees).toEqual([
			expect.objectContaining({ login: "alice" }),
		]);
		const number = created.body.number;
		const cleared = await call(`/repos/alice/filters/issues/${number}`, {
			...asToken(alice),
			method: "PATCH",
			body: JSON.stringify({ assignee: null }),
		});
		expect(cleared.status).toBe(200);
		expect(cleared.body.assignees).toEqual([]);
	});
});

describe("since and before on the repository lists", () => {
	it("bounds /user/repos by the last update", async () => {
		const names = async (query: string) =>
			(await call(`/user/repos?${query}`, asToken(alice))).body.map(
				(repo: { name: string }) => repo.name,
			);
		expect(await names(`since=${PAST}`)).toContain("filters");
		expect(await names(`since=${FUTURE}`)).toEqual([]);
		expect(await names(`before=${PAST}`)).toEqual([]);
	});
});

describe("type on /users/{username}/repos", () => {
	it("lists the repositories a user collaborates on as member", async () => {
		const names = async (query: string) =>
			(await call(`/users/bob/repos?${query}`)).body.map(
				(repo: { name: string }) => repo.name,
			);
		expect(await names("type=member")).toEqual(["filters"]);
		expect(await names("type=owner")).toEqual([]);
		expect(await names("type=all")).toEqual(["filters"]);
		// bob's default is his own repositories.
		expect(await names("")).toEqual([]);
	});
});

describe("since on issue comments", () => {
	it("keeps the comments updated at or after the time", async () => {
		const created = await call(
			"/repos/alice/filters/issues/1/comments",
			post(alice, { body: "A comment" }),
		);
		expect(created.status).toBe(201);
		const all = await call("/repos/alice/filters/issues/1/comments");
		expect(all.body).toHaveLength(1);
		const since = await call(
			`/repos/alice/filters/issues/1/comments?since=${FUTURE}`,
		);
		expect(since.body).toEqual([]);
		const past = await call(
			`/repos/alice/filters/issues/1/comments?since=${PAST}`,
		);
		expect(past.body).toHaveLength(1);
	});
});

describe("pagination the contract declares", () => {
	it("pages the repository topics", async () => {
		const put = await call("/repos/alice/filters/topics", {
			...asToken(alice),
			method: "PUT",
			body: JSON.stringify({ names: ["alpha", "beta", "gamma"] }),
		});
		expect(put.status).toBe(200);
		const page = await call(
			"/repos/alice/filters/topics?per_page=2&page=2",
			asToken(alice),
		);
		expect(page.status).toBe(200);
		expect(page.body).toEqual({ names: ["gamma"] });
	});

	it("pages the labels on an issue", async () => {
		for (const name of ["one", "two", "three"]) {
			const label = await call(
				"/repos/alice/filters/labels",
				post(alice, { name, color: "ffffff" }),
			);
			expect(label.status).toBe(201);
		}
		const added = await call(
			"/repos/alice/filters/issues/1/labels",
			post(alice, { labels: ["one", "two", "three"] }),
		);
		expect(added.status).toBe(200);
		const first = await call(
			"/repos/alice/filters/issues/1/labels?per_page=2&page=1",
			asToken(alice),
		);
		const second = await call(
			"/repos/alice/filters/issues/1/labels?per_page=2&page=2",
			asToken(alice),
		);
		expect(first.body).toHaveLength(2);
		expect(second.body).toHaveLength(1);
		const names = [...first.body, ...second.body].map(
			(label: { name: string }) => label.name,
		);
		expect(names).toEqual(expect.arrayContaining(["one", "two", "three"]));
	});
});
