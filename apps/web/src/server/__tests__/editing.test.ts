/**
 * @vitest-environment node
 *
 * Editing and deleting: authors (and write collaborators) edit titles, bodies
 * and comments; edits leave an "edited" marker, titles a `renamed` event, and
 * edited text re-runs cross-references.
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
const repositories = await import("../repositories");
const issues = await import("../issues");
const comments = await import("../comments");
const { getTimeline } = await import("../timeline");

const users = await createUsers("owner", "author", "other");
let repoId: number;

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "t" } })).id;
});

describe("editing issues", () => {
	it("marks body edits, records renames, and re-runs cross-references", async () => {
		signIn(users.author);
		const target = await issues.createIssue({ data: { repoId, title: "T" } });
		const issue = await issues.createIssue({
			data: { repoId, title: "Old", body: "first" },
		});
		expect(issue.editedAt).toBeNull();

		const renamed = await issues.updateIssue({
			data: { issueId: issue.id, title: "New" },
		});
		expect(renamed.editedAt).toBeNull();
		const edited = await issues.updateIssue({
			data: { issueId: issue.id, body: `see #${target.number}` },
		});
		expect(edited.editedAt).not.toBeNull();

		const own = await getTimeline({ data: { repoId, number: issue.number } });
		expect(own.map((e) => e.event)).toEqual(["renamed"]);
		expect(own[0]).toMatchObject({ from: "Old", to: "New" });
		const theirs = await getTimeline({
			data: { repoId, number: target.number },
		});
		expect(theirs.map((e) => e.event)).toEqual(["cross-referenced"]);
	});

	it("refuses edits from a reader who isn't the author", async () => {
		signIn(users.author);
		const issue = await issues.createIssue({ data: { repoId, title: "Mine" } });
		signIn(users.other);
		await expect(
			issues.updateIssue({ data: { issueId: issue.id, title: "Other" } }),
		).rejects.toThrow("Access denied");
		signIn(users.owner);
		await expect(
			issues.updateIssue({ data: { issueId: issue.id, title: "Moderated" } }),
		).resolves.toMatchObject({ title: "Moderated" });
	});
});

describe("editing comments", () => {
	it("lets the author edit and delete, and a reader do neither", async () => {
		signIn(users.author);
		const issue = await issues.createIssue({ data: { repoId, title: "C" } });
		const comment = await comments.createComment({
			data: { issueId: issue.id, body: "hello" },
		});
		expect(comment?.editedAt).toBeNull();
		const id = comment?.id as number;

		const edited = await comments.updateComment({
			data: { commentId: id, body: "hello again" },
		});
		expect(edited).toMatchObject({ body: "hello again" });
		expect(edited.editedAt).not.toBeNull();

		signIn(users.other);
		await expect(
			comments.updateComment({ data: { commentId: id, body: "x" } }),
		).rejects.toThrow("Access denied");
		await expect(
			comments.deleteComment({ data: { commentId: id } }),
		).rejects.toThrow("Access denied");

		signIn(users.owner);
		await comments.deleteComment({ data: { commentId: id } });
		expect(await comments.getComments({ data: { issueId: issue.id } })).toEqual(
			[],
		);
	});

	it("deleting a comment removes the cross-references it created", async () => {
		signIn(users.author);
		const gone = await issues.createIssue({ data: { repoId, title: "Gone" } });
		const kept = await issues.createIssue({ data: { repoId, title: "Kept" } });
		const issue = await issues.createIssue({
			data: { repoId, title: "Src", body: `body mentions #${kept.number}` },
		});
		const first = await comments.createComment({
			data: {
				issueId: issue.id,
				body: `see #${gone.number} and #${kept.number}`,
			},
		});
		const events = (number: number) =>
			getTimeline({ data: { repoId, number } }).then((t) =>
				t.map((e) => e.event),
			);
		expect(await events(gone.number)).toEqual(["cross-referenced"]);
		expect(await events(kept.number)).toEqual(["cross-referenced"]);

		await comments.deleteComment({ data: { commentId: first.id } });
		expect(await events(gone.number)).toEqual([]);
		expect(await events(kept.number)).toEqual(["cross-referenced"]);
	});
});
