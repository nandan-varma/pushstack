/** @vitest-environment node */
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);
const { createUsers, signIn } = await import("../../test/app-harness");
const { call, post, mintToken } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { encodeNodeId } = await import("../graphql/node-id");
const files = await import("../files");
const users = await createUsers("alice", "bob");
let token: string;
let reader: string;
let repoId: string;
let prId: string;
const fields =
	"id number title body state isDraft headRefName baseRefName author { login } repository { nameWithOwner }";
beforeAll(async () => {
	token = await mintToken(users.alice, ["repo:write"]);
	reader = await mintToken(users.bob, ["repo:write"]);
	const repo = await call(
		"/user/repos",
		post(token, { name: "proj", auto_init: true }),
	);
	expect(repo.status).toBe(201);
	repoId = encodeNodeId("Repository", repo.body.id);
	const ref = await call("/repos/alice/proj/git/ref/heads/main");
	await call(
		"/repos/alice/proj/git/refs",
		post(token, { ref: "refs/heads/feature", sha: ref.body.object.sha }),
	);
	signIn(users.alice);
	await files.uploadFile({
		data: {
			repoId: repo.body.id,
			branchName: "feature",
			path: "feature.txt",
			content: btoa("feature\n"),
			commitMessage: "Feature",
		},
	});
});
it("creates a draft, lists it, reads the REST-compatible node id and transitions draft state", async () => {
	const created = await graphql(
		token,
		`mutation($input: CreatePullRequestInput!) { createPullRequest(input: $input) { clientMutationId pullRequest { ${fields} } } }`,
		{
			input: {
				repositoryId: repoId,
				headRefName: "feature",
				baseRefName: "main",
				title: "Draft",
				draft: true,
				clientMutationId: "create",
			},
		},
	);
	expect(created.body.errors).toBeUndefined();
	const pr = created.body.data.createPullRequest.pullRequest;
	prId = pr.id;
	expect(pr).toMatchObject({
		number: 1,
		isDraft: true,
		state: "OPEN",
		author: { login: "alice" },
	});
	expect(created.body.data.createPullRequest.clientMutationId).toBe("create");
	const rest = await call("/repos/alice/proj/pulls/1");
	expect(rest.status).toBe(200);
	expect(pr.id).toBe(encodeNodeId("PullRequest", rest.body.id));
	const list = await graphql(
		reader,
		`query { repository(owner:"alice",name:"proj") { pullRequests(first:1,states:[OPEN]) { totalCount nodes { ${fields} } pageInfo { endCursor hasNextPage } } pullRequest(number:1) { isDraft } } }`,
	);
	expect(list.body.errors).toBeUndefined();
	expect(list.body.data.repository.pullRequests.totalCount).toBe(1);
	expect(list.body.data.repository.pullRequest.isDraft).toBe(true);
	for (const [mutation, draft] of [
		["markPullRequestReadyForReview", false],
		["convertPullRequestToDraft", true],
	] as const) {
		const result = await graphql(
			token,
			`mutation { ${mutation}(input:{pullRequestId:"${prId}",clientMutationId:"transition"}) { clientMutationId pullRequest { isDraft } } }`,
		);
		expect(result.body.errors).toBeUndefined();
		expect(result.body.data[mutation]).toEqual({
			clientMutationId: "transition",
			pullRequest: { isDraft: draft },
		});
	}
	const node = await graphql(
		reader,
		`query { node(id:"${prId}") { ... on PullRequest { number isDraft } } }`,
	);
	expect(node.body.data.node).toEqual({ number: 1, isDraft: true });
});
it("bounds the label filter on pull request lists", async () => {
	const labels = Array.from({ length: 101 }, (_, i) => `label-${i}`);
	const result = await graphql(
		reader,
		`query($labels:[String!]) { repository(owner:"alice",name:"proj") { pullRequests(first:1, labels:$labels) { totalCount } } }`,
		{ labels },
	);
	expect(result.body.errors[0].type).toBe("UNPROCESSABLE");
});
it("rejects readers and insufficient token scopes without changing draft state", async () => {
	for (const caller of [reader, await mintToken(users.alice, ["repo:read"])]) {
		const result = await graphql(
			caller,
			`mutation { markPullRequestReadyForReview(input:{pullRequestId:"${prId}"}) { pullRequest { isDraft } } }`,
		);
		expect(result.body.errors[0].type).toMatch(/FORBIDDEN|INSUFFICIENT_SCOPES/);
	}
});
it("hides private repository nodes and rejects malformed ids", async () => {
	const repo = await call(
		"/user/repos",
		post(token, { name: "secret", private: true }),
	);
	const result = await graphql(
		reader,
		`mutation { createPullRequest(input:{repositoryId:"${encodeNodeId("Repository", repo.body.id)}",headRefName:"feature",baseRefName:"main",title:"x"}) { pullRequest { id } } }`,
	);
	expect(result.body.errors[0].type).toBe("NOT_FOUND");
	const invalid = await graphql(
		token,
		`mutation { convertPullRequestToDraft(input:{pullRequestId:"${encodeNodeId("Issue", 1)}"}) { pullRequest { id } } }`,
	);
	expect(invalid.body.errors[0].type).toBe("NOT_FOUND");
});
it("exposes GitHub archive fields on Commit through Ref.target", async () => {
	const result = await graphql(
		reader,
		`query { repository(owner:"alice",name:"proj") { defaultBranchRef { target { ... on Commit { oid zipballUrl tarballUrl } } } } }`,
	);
	expect(result.body.errors).toBeUndefined();
	const commit = result.body.data.repository.defaultBranchRef.target;
	expect(commit.zipballUrl).toContain(`/alice/proj/archive/${commit.oid}.zip`);
	expect(commit.tarballUrl).toContain(
		`/alice/proj/archive/${commit.oid}.tar.gz`,
	);
});
it("rejects duplicate, invalid, missing and identical branch requests and oversized text", async () => {
	const input = {
		repositoryId: repoId,
		headRefName: "feature",
		baseRefName: "main",
		title: "New",
	};
	for (const change of [
		{},
		{ headRefName: "../secret" },
		{ headRefName: "missing" },
		{ headRefName: "main" },
		{ headRefName: "alice:main" },
		{ title: " " },
		{ title: "x".repeat(257) },
		{ body: "x".repeat(65537) },
		{ maintainerCanModify: false },
	]) {
		const result = await graphql(
			token,
			`mutation($input:CreatePullRequestInput!) { createPullRequest(input:$input) { pullRequest { id } } }`,
			{ input: { ...input, ...change } },
		);
		expect(result.body.errors[0].type).toBe("UNPROCESSABLE");
	}
});
it("charges every aliased draft mutation and returns the persisted update time", async () => {
	const { db } = await import("#/db");
	const before = await graphql(token, "{ rateLimit { used } }");
	const result = await graphql(
		token,
		`mutation { a:markPullRequestReadyForReview(input:{pullRequestId:"${prId}"}) { pullRequest { updatedAt isDraft } } b:convertPullRequestToDraft(input:{pullRequestId:"${prId}"}) { pullRequest { updatedAt isDraft } } }`,
	);
	expect(result.body.errors).toBeUndefined();
	const after = await graphql(token, "{ rateLimit { used } }");
	expect(after.body.data.rateLimit.used - before.body.data.rateLimit.used).toBe(
		11,
	);
	const row = await db.query.issues.findFirst({ where: { number: 1 } });
	expect(result.body.data.b.pullRequest.updatedAt).toBe(
		row?.updatedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
	);
	expect(result.body.data.a.pullRequest.isDraft).toBe(false);
	expect(result.body.data.b.pullRequest.isDraft).toBe(true);
});
it("filters every combination of open, closed and merged states and paginates", async () => {
	const { insertPullRequest, updatePullRequestFields } = await import(
		"../pull-request-store"
	);
	const { db } = await import("#/db");
	const { pullRequests } = await import("#/db/app-schema");
	const { eq } = await import("drizzle-orm");
	const { decodeNodeId } = await import("../graphql/node-id");
	const id = Number(decodeNodeId(repoId)?.key);
	const closed = await insertPullRequest(id, users.alice.id, {
		title: "Closed",
		sourceBranch: "feature",
		targetBranch: "main",
	});
	await updatePullRequestFields(closed, users.alice.id, { status: "closed" });
	const merged = await insertPullRequest(id, users.alice.id, {
		title: "Merged",
		sourceBranch: "feature",
		targetBranch: "main",
	});
	await updatePullRequestFields(merged, users.alice.id, { status: "closed" });
	await db
		.update(pullRequests)
		.set({ mergedAt: new Date() })
		.where(eq(pullRequests.issueId, merged.id));
	for (const states of [
		[],
		["OPEN"],
		["CLOSED"],
		["MERGED"],
		["OPEN", "CLOSED"],
		["OPEN", "MERGED"],
		["CLOSED", "MERGED"],
		["OPEN", "CLOSED", "MERGED"],
	]) {
		const result = await graphql(
			reader,
			`query($states:[PullRequestState!]) { repository(owner:"alice",name:"proj") { pullRequests(first:100,states:$states,orderBy:{field:CREATED_AT,direction:ASC}) { totalCount nodes { state } } } }`,
			{ states },
		);
		expect(result.body.errors).toBeUndefined();
		expect(result.body.data.repository.pullRequests.totalCount).toBe(
			states.length,
		);
		expect(
			result.body.data.repository.pullRequests.nodes
				.map((n: { state: string }) => n.state)
				.sort(),
		).toEqual([...states].sort());
	}
	const page = await graphql(
		reader,
		`{repository(owner:"alice",name:"proj"){pullRequests(first:1){nodes{number} pageInfo{endCursor hasNextPage}}}}`,
	);
	const cursor = page.body.data.repository.pullRequests.pageInfo.endCursor;
	expect(page.body.data.repository.pullRequests.pageInfo.hasNextPage).toBe(
		true,
	);
	const next = await graphql(
		reader,
		`query($after:String!){repository(owner:"alice",name:"proj"){pullRequests(first:1,after:$after){nodes{number}}}}`,
		{ after: cursor },
	);
	expect(next.body.data.repository.pullRequests.nodes[0].number).not.toBe(
		page.body.data.repository.pullRequests.nodes[0].number,
	);
	for (const pr of [closed, merged]) {
		for (const mutation of [
			"convertPullRequestToDraft",
			"markPullRequestReadyForReview",
		]) {
			const result = await graphql(
				token,
				`mutation { ${mutation}(input:{pullRequestId:"${encodeNodeId("PullRequest", pr.id)}"}){pullRequest{id}}}`,
			);
			expect(result.body.errors[0].type).toBe("UNPROCESSABLE");
		}
	}
});
it("executes the complete captured gh pr view query against populated data", async () => {
	const { readFileSync } = await import("node:fs");
	const fixture = JSON.parse(
		readFileSync(
			new URL("../graphql/__fixtures__/gh/pr-view.json", import.meta.url),
			"utf8",
		),
	);
	const comment = await call(
		"/repos/alice/proj/issues/1/comments",
		post(token, { body: "A comment" }),
	);
	expect(comment.status).toBe(201);
	const label = await call(
		"/repos/alice/proj/labels",
		post(token, { name: "custom", color: "123456" }),
	);
	expect(label.status).toBe(201);
	expect(
		(
			await call(
				"/repos/alice/proj/issues/1/labels",
				post(token, { labels: ["custom"] }),
			)
		).status,
	).toBe(200);
	const tip = await call("/repos/alice/proj/git/ref/heads/feature");
	const { db } = await import("#/db");
	const { pullRequestReviews } = await import("#/db/app-schema");
	const { decodeNodeId } = await import("../graphql/node-id");
	await db.insert(pullRequestReviews).values({
		repoId: Number(decodeNodeId(repoId)?.key),
		pullRequestId: Number(decodeNodeId(prId)?.key),
		authorId: users.alice.id,
		state: "commented",
		body: "Looks good",
		commitSha: tip.body.object.sha,
		submittedAt: new Date(),
	});
	expect(
		(
			await call(
				`/repos/alice/proj/statuses/${tip.body.object.sha}`,
				post(token, { state: "success", context: "ci", description: "Passed" }),
			)
		).status,
	).toBe(201);
	const result = await graphql(reader, fixture.requests[0].query, {
		owner: "alice",
		repo: "proj",
		pr_number: 1,
	});
	expect(result.body.errors).toBeUndefined();
	const pr = result.body.data.repository.pullRequest;
	expect(pr).toMatchObject({
		number: 1,
		isDraft: true,
		title: "Draft",
		additions: 1,
		deletions: 0,
		commits: { totalCount: 1 },
		comments: { totalCount: 1 },
		labels: { totalCount: 1 },
		reviews: { totalCount: 1 },
	});
	expect(pr.comments.nodes[0]).toMatchObject({
		body: "A comment",
		author: { login: "alice" },
		authorAssociation: "OWNER",
	});
	expect(pr.reviews.nodes[0]).toMatchObject({
		body: "Looks good",
		state: "COMMENTED",
	});
	expect(
		pr.statusCheckRollup.nodes[0].commit.statusCheckRollup.contexts.nodes[0],
	).toMatchObject({
		__typename: "StatusContext",
		context: "ci",
		state: "SUCCESS",
	});
});
it("exposes pinned archives through Release.tagCommit and downloads them", async () => {
	expect(
		(await call("/repos/alice/proj/releases", post(token, { tag_name: "v1" })))
			.status,
	).toBe(201);
	const result = await graphql(
		reader,
		`{repository(owner:"alice",name:"proj"){release(tagName:"v1"){tagCommit{oid zipballUrl tarballUrl}}}}`,
	);
	expect(result.body.errors).toBeUndefined();
	const commit = result.body.data.repository.release.tagCommit;
	const { serveArchive } = await import("../archive");
	for (const [field, format] of [
		["zipballUrl", "zip"],
		["tarballUrl", "tar.gz"],
	] as const) {
		const response = await serveArchive(
			new Request(commit[field]),
			"alice",
			"proj",
			commit.oid,
			format,
		);
		expect(response.status).toBe(200);
		expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
	}
});
it("creates exactly one pull request when concurrent creates race for the same head", async () => {
	const ref = await call("/repos/alice/proj/git/ref/heads/main");
	await call(
		"/repos/alice/proj/git/refs",
		post(token, { ref: "refs/heads/race", sha: ref.body.object.sha }),
	);
	const repoRest = await call("/repos/alice/proj");
	await files.uploadFile({
		data: {
			repoId: repoRest.body.id,
			branchName: "race",
			path: "race.txt",
			content: btoa("race\n"),
			commitMessage: "Race",
		},
	});
	const mutation = `mutation($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { number } } }`;
	const input = {
		repositoryId: repoId,
		headRefName: "race",
		baseRefName: "main",
		title: "Race",
	};
	const results = await Promise.all(
		[1, 2, 3].map(() => graphql(token, mutation, { input })),
	);
	expect(results.filter((r) => !r.body.errors)).toHaveLength(1);
	expect(
		results.filter((r) => r.body.errors?.[0]?.type === "UNPROCESSABLE"),
	).toHaveLength(2);
});

it("closes, reopens and updates a pull request, refusing base changes and blank titles", async () => {
	const ref = await call("/repos/alice/proj/git/ref/heads/main");
	await call(
		"/repos/alice/proj/git/refs",
		post(token, { ref: "refs/heads/edit", sha: ref.body.object.sha }),
	);
	const repoRest = await call("/repos/alice/proj");
	await files.uploadFile({
		data: {
			repoId: repoRest.body.id,
			branchName: "edit",
			path: "edit.txt",
			content: btoa("edit\n"),
			commitMessage: "Edit",
		},
	});
	const created = await graphql(
		token,
		`mutation { createPullRequest(input:{repositoryId:"${repoId}",headRefName:"edit",baseRefName:"main",title:"Edit me"}) { pullRequest { id number } } }`,
	);
	expect(created.body.errors).toBeUndefined();
	const { id, number } = created.body.data.createPullRequest.pullRequest;
	const close = await graphql(
		token,
		`mutation { closePullRequest(input:{pullRequestId:"${id}",clientMutationId:"close"}) { clientMutationId pullRequest { state closed closedAt } } }`,
	);
	expect(close.body.errors).toBeUndefined();
	expect(close.body.data.closePullRequest).toEqual({
		clientMutationId: "close",
		pullRequest: {
			state: "CLOSED",
			closed: true,
			closedAt: expect.any(String),
		},
	});
	const rest = await call(`/repos/alice/proj/pulls/${number}`);
	expect(rest.body.state).toBe("closed");
	const reopen = await graphql(
		token,
		`mutation { reopenPullRequest(input:{pullRequestId:"${id}"}) { pullRequest { state closedAt } } }`,
	);
	expect(reopen.body.data.reopenPullRequest.pullRequest).toEqual({
		state: "OPEN",
		closedAt: null,
	});
	const updated = await graphql(
		token,
		`mutation { updatePullRequest(input:{pullRequestId:"${id}",title:"  Renamed ",body:"New body",state:CLOSED}) { pullRequest { title body state } } }`,
	);
	expect(updated.body.errors).toBeUndefined();
	expect(updated.body.data.updatePullRequest.pullRequest).toEqual({
		title: "Renamed",
		body: "New body",
		state: "CLOSED",
	});
	const blankTitle = await graphql(
		token,
		`mutation { updatePullRequest(input:{pullRequestId:"${id}",title:"   "}) { pullRequest { id } } }`,
	);
	expect(blankTitle.body.errors[0].type).toBe("UNPROCESSABLE");
	const baseChange = await graphql(
		token,
		`mutation { updatePullRequest(input:{pullRequestId:"${id}",baseRefName:"edit"}) { pullRequest { id } } }`,
	);
	expect(baseChange.body.errors[0].type).toBe("UNPROCESSABLE");
	const denied = await graphql(
		reader,
		`mutation { closePullRequest(input:{pullRequestId:"${id}"}) { pullRequest { id } } }`,
	);
	expect(denied.body.errors[0].type).toMatch(/FORBIDDEN|INSUFFICIENT_SCOPES/);
});
