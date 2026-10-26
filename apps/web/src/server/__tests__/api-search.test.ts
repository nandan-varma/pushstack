/**
 * @vitest-environment node
 *
 * `GET /search/repositories`, `GET /search/issues` and `GET /meta` over the real
 * dispatcher and pglite: what each query finds for an anonymous caller and for
 * readers, what it refuses (a 422 naming the qualifier, never a wider answer),
 * and the sort, order and page bounds.
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
const { call, mintToken, patch, post } = await import("../../test/api-client");
const files = await import("../files");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;

const names = (body: { items: { full_name?: string; title?: string }[] }) =>
	body.items.map((item) => item.full_name ?? item.title);

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	signIn(users.alice);
	const proj = await call(
		"/user/repos",
		post(alice, {
			name: "proj",
			description: "The search target",
			auto_init: true,
		}),
	);
	expect(proj.status).toBe(201);
	const secret = await call(
		"/user/repos",
		post(alice, { name: "secret", private: true, auto_init: true }),
	);
	expect(secret.status).toBe(201);
	const bobs = await call(
		"/user/repos",
		post(bob, { name: "bobs", description: "Another target" }),
	);
	expect(bobs.status).toBe(201);

	const first = await call(
		"/repos/alice/proj/issues",
		post(alice, { title: "Broken build" }),
	);
	expect(first.status).toBe(201);
	const done = await call(
		"/repos/alice/proj/issues",
		post(alice, { title: "Done thing" }),
	);
	expect(done.status).toBe(201);
	expect(
		(
			await call(
				`/repos/alice/proj/issues/${done.body.number}`,
				patch(alice, { state: "closed" }),
			)
		).status,
	).toBe(200);
	expect(
		(
			await call(
				"/repos/alice/secret/issues",
				post(alice, { title: "Secret bug" }),
			)
		).status,
	).toBe(201);

	const ref = await call("/repos/alice/proj/git/ref/heads/main");
	await call(
		"/repos/alice/proj/git/refs",
		post(alice, { ref: "refs/heads/feature", sha: ref.body.object.sha }),
	);
	await files.uploadFile({
		data: {
			repoId: proj.body.id,
			branchName: "feature",
			path: "feature.txt",
			content: btoa("feature\n"),
			commitMessage: "Feature",
		},
	});
	const pr = await call(
		"/repos/alice/proj/pulls",
		post(alice, { title: "Feature PR", head: "feature", base: "main" }),
	);
	expect(pr.status).toBe(201);
});

describe("GET /search/repositories", () => {
	it("finds public repositories by words in name or description, anonymously", async () => {
		const { status, body } = await call("/search/repositories?q=target");
		expect(status).toBe(200);
		expect(body.incomplete_results).toBe(false);
		expect(body.total_count).toBe(2);
		expect(names(body).sort()).toEqual(["alice/proj", "bob/bobs"]);
	});

	it("hides private repositories from anonymous callers and shows them to their readers", async () => {
		expect((await call("/search/repositories?q=secret")).body).toEqual({
			total_count: 0,
			incomplete_results: false,
			items: [],
		});
		const owner = await call("/search/repositories?q=secret", {
			authorization: `token ${alice}`,
		});
		expect(names(owner.body)).toEqual(["alice/secret"]);
		const other = await call("/search/repositories?q=secret", {
			authorization: `token ${bob}`,
		});
		expect(other.body.total_count).toBe(0);
	});

	it("narrows by user: and is:, and ANDs topics and words", async () => {
		expect(
			names((await call("/search/repositories?q=target+user:bob")).body),
		).toEqual(["bob/bobs"]);
		expect(
			(await call("/search/repositories?q=target+is:private")).body.total_count,
		).toBe(0);
		expect(
			(await call("/search/repositories?q=is:public+user:alice")).body
				.total_count,
		).toBe(1);
	});

	it("refuses qualifiers it does not serve with a 422 that names them", async () => {
		for (const q of [
			"language:go",
			"fork:true",
			"in:name",
			"-user:bob",
			"http://example.test",
			"is:fork",
			"user:",
		]) {
			const { status, body } = await call(
				`/search/repositories?q=${encodeURIComponent(q)}`,
			);
			expect(status, q).toBe(422);
			expect(body.errors[0]).toMatchObject({
				resource: "Search",
				field: "q",
				code: "invalid",
			});
		}
	});

	it("sorts by updated with order, and refuses other sorts", async () => {
		const asc = await call(
			"/search/repositories?q=target&sort=updated&order=asc",
		);
		expect(names(asc.body).sort()).toEqual(["alice/proj", "bob/bobs"]);
		expect(
			(await call("/search/repositories?q=target&sort=stars")).status,
		).toBe(422);
	});
});

describe("GET /search/issues", () => {
	it("finds issues and pull requests across the repositories the caller can read", async () => {
		const { status, body } = await call("/search/issues?q=state:open", {
			authorization: `token ${alice}`,
		});
		expect(status).toBe(200);
		expect(body.total_count).toBe(3);
		expect(
			body.items.map((item: { title: string }) => item.title).sort(),
		).toEqual(["Broken build", "Feature PR", "Secret bug"]);
		const anonymous = await call("/search/issues?q=state:open");
		expect(
			anonymous.body.items.map((item: { title: string }) => item.title).sort(),
		).toEqual(["Broken build", "Feature PR"]);
	});

	it("serves is:pr and type:pr, and a repo: scope", async () => {
		const prs = await call("/search/issues?q=type:pr", {
			authorization: `token ${alice}`,
		});
		expect(prs.body.items.map((item: { title: string }) => item.title)).toEqual(
			["Feature PR"],
		);
		expect(prs.body.items[0].pull_request).toBeDefined();
		const scoped = await call("/search/issues?q=repo:alice/proj+is:closed", {
			authorization: `token ${alice}`,
		});
		expect(
			scoped.body.items.map((item: { title: string }) => item.title),
		).toEqual(["Done thing"]);
	});

	it("sorts with sort and order, newest first by default", async () => {
		const oldest = await call(
			"/search/issues?q=repo:alice/proj&sort=created&order=asc",
			{ authorization: `token ${alice}` },
		);
		expect(
			oldest.body.items.map((item: { title: string }) => item.title)[0],
		).toBe("Broken build");
		const newest = await call("/search/issues?q=repo:alice/proj", {
			authorization: `token ${alice}`,
		});
		expect(
			newest.body.items.map((item: { title: string }) => item.title)[0],
		).toBe("Feature PR");
	});

	it("refuses unserved qualifiers, a negated qualifier, scheme text and two scopes, with 422", async () => {
		for (const q of [
			"in:title broken",
			"comments:>3",
			"created:>2020-01-01",
			"is:locked",
			"no:project",
			"-label:bug",
			"label:",
			"draft:maybe",
			"http://example.test",
			"repo:alice/proj repo:bob/bobs",
		]) {
			const { status, body } = await call(
				`/search/issues?q=${encodeURIComponent(q)}`,
			);
			expect(status, q).toBe(422);
			expect(body.errors[0]).toMatchObject({
				resource: "Search",
				field: "q",
				code: "invalid",
			});
		}
	});

	it("answers an empty page past the skip bound and a contradictory query with nothing", async () => {
		const past = await call(
			"/search/issues?q=state:open&page=102&per_page=100",
		);
		expect(past.body.items).toEqual([]);
		const contradictory = await call("/search/issues?q=is:open+is:closed", {
			authorization: `token ${alice}`,
		});
		expect(contradictory.body).toEqual({
			total_count: 0,
			incomplete_results: false,
			items: [],
		});
	});
});

describe("GET /meta", () => {
	it("answers the placeholder installed_version gh reads for a non-github.com host", async () => {
		expect((await call("/meta")).body).toEqual({ installed_version: "0.0.0" });
	});
});
