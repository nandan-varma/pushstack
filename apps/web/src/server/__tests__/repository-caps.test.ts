/**
 * @vitest-environment node
 *
 * Per-repository caps: a create past the cap is refused (422 on REST, an error
 * on the web), the label list is paged in SQL, and deleting a comment reads
 * only the comments that mention its references.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({ log: [] as string[] }));

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb({
		onQuery: (query) => {
			queries.log.push(query);
		},
	}),
}));
vi.mock("#/lib/limits", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/limits")>()),
	// Small enough to reach: the default label set alone is 11 labels.
	MAX_LABELS_PER_REPOSITORY: 13,
	MAX_MILESTONES_PER_REPOSITORY: 2,
	MAX_RELEASES_PER_REPOSITORY: 2,
	MAX_COLLABORATORS_PER_REPOSITORY: 1,
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const { call, mintToken, post } = await import("../../test/api-client");
const repositories = await import("../repositories");
const labelFns = await import("../labels");
const milestoneFns = await import("../milestones");
const issues = await import("../issues");
const comments = await import("../comments");
const { getTimeline } = await import("../timeline");

const users = await createUsers("owner", "bob", "carol");
let repoId: number;
let token: string;
const auth = () => ({ authorization: `token ${token}` });

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "caps" } })).id;
	token = await mintToken(users.owner, ["repo:write"]);
});

describe("labels", () => {
	it("refuses the label past the cap, on REST and the web", async () => {
		const { labels } = await labelFns.getLabels({ data: { repoId } });
		for (let i = labels.length; i < 13; i++) {
			await labelFns.createLabel({
				data: { repoId, name: `fill-${i}`, color: "000000" },
			});
		}
		await expect(
			labelFns.createLabel({ data: { repoId, name: "over", color: "000000" } }),
		).rejects.toThrow("at most 13 labels");
		const response = await call(
			"/repos/owner/caps/labels",
			post(token, { name: "over", color: "000000" }),
		);
		expect(response.status).toBe(422);
		expect(response.body.message).toBe("A repository holds at most 13 labels");
	});

	it("answers a page past the skip bound empty, with the same Link as pagedList", async () => {
		const page = await call(
			"/repos/owner/caps/labels?per_page=5&page=10000",
			auth(),
		);
		expect(page.status).toBe(200);
		expect(page.body).toEqual([]);
		const link = page.headers.get("link") ?? "";
		expect(link).toContain('rel="prev"');
		expect(link).toContain('rel="first"');
	});

	it("lists labels a page at a time, limited in SQL", async () => {
		const all = (await labelFns.getLabels({ data: { repoId } })).labels.map(
			(label) => label.name,
		);
		queries.log.length = 0;
		const page = await call(
			"/repos/owner/caps/labels?per_page=5&page=3",
			auth(),
		);
		expect(page.status).toBe(200);
		expect(page.body.map((label: { name: string }) => label.name)).toEqual(
			all.slice(10),
		);
		expect(page.headers.get("link")).toContain('rel="first"');
		expect(
			queries.log.some((sql) => /from "labels"[\s\S]*limit/i.test(sql)),
		).toBe(true);
	});
});

describe("milestones", () => {
	it("refuses the milestone past the cap, on REST and the web", async () => {
		for (const title of ["one", "two"]) {
			await milestoneFns.createMilestone({ data: { repoId, title } });
		}
		await expect(
			milestoneFns.createMilestone({ data: { repoId, title: "three" } }),
		).rejects.toThrow("at most 2 milestones");
		const response = await call(
			"/repos/owner/caps/milestones",
			post(token, { title: "three" }),
		);
		expect(response.status).toBe(422);
	});
});

describe("releases", () => {
	it("refuses the release past the cap", async () => {
		for (const tag_name of ["v1", "v2"]) {
			const made = await call(
				"/repos/owner/caps/releases",
				post(token, { tag_name, draft: true }),
			);
			expect(made.status).toBe(201);
		}
		const response = await call(
			"/repos/owner/caps/releases",
			post(token, { tag_name: "v3", draft: true }),
		);
		expect(response.status).toBe(422);
		expect(response.body.message).toBe("A repository holds at most 2 releases");
	});
});

describe("collaborators", () => {
	it("refuses a new collaborator past the cap, but changes an existing role", async () => {
		await repositories.addCollaboratorByUsername({
			data: { repoId, username: "bob", role: "read" },
		});
		await expect(
			repositories.addCollaboratorByUsername({
				data: { repoId, username: "carol", role: "read" },
			}),
		).rejects.toThrow("at most 1 collaborators");
		const changed = await repositories.addCollaboratorByUsername({
			data: { repoId, username: "bob", role: "write" },
		});
		expect(changed.role).toBe("write");
	});
});

describe("comment deletion", () => {
	it("reads only the comments that mention the deleted comment's references", async () => {
		signIn(users.owner);
		const target = await issues.createIssue({
			data: { repoId, title: "Target" },
		});
		const source = await issues.createIssue({
			data: { repoId, title: "Source" },
		});
		// Unrelated comments the deletion must not need to read.
		for (let i = 0; i < 20; i++) {
			await comments.createComment({
				data: { issueId: source.id, body: `plain ${i}` },
			});
		}
		// Zero-padded, which the parser reads as the same number.
		const kept = await comments.createComment({
			data: { issueId: source.id, body: `also #00${target.number}` },
		});
		const gone = await comments.createComment({
			data: { issueId: source.id, body: `see #${target.number}` },
		});
		const events = () =>
			getTimeline({ data: { repoId, number: target.number } }).then((t) =>
				t.map((e) => e.event),
			);
		expect(await events()).toEqual(["cross-referenced"]);

		queries.log.length = 0;
		await comments.deleteComment({ data: { commentId: gone.id } });
		expect(
			queries.log.some((sql) => /from "comments"/.test(sql) && / ~ /.test(sql)),
		).toBe(true);
		expect(await events()).toEqual(["cross-referenced"]);
		await comments.deleteComment({ data: { commentId: kept.id } });
		expect(await events()).toEqual([]);
	});
});
