/**
 * @vitest-environment node
 *
 * In-app notifications: one thread per issue/PR per user, GitHub's reasons,
 * unread/read, the participating filter, subscriptions, the actor never
 * notified, private repositories, and a fixed query count when recording.
 */
import { isNotFound } from "@tanstack/react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({ count: 0 }));

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb({
		onQuery: () => {
			queries.count++;
		},
	}),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const issues = await import("../issues");
const comments = await import("../comments");
const assignees = await import("../assignees");
const n = await import("../notifications");
const files = await import("../files");
const pulls = await import("../pull-requests");
const { getRepositoryAccess, canReadRepositoryCondition } = await import(
	"../repo-access"
);
const { db } = await import("#/db");
const schema = await import("#/db/app-schema");
const { user: userTable } = await import("#/db/schema");
const { and, eq, sql } = await import("drizzle-orm");

const users = await createUsers(
	"owner",
	"alice",
	"bob",
	"carol",
	"eve",
	"watcher1",
	"watcher2",
	"watcher3",
	"watcher4",
	"frank",
	"gina",
	"pager",
);

/** Raw rows, bypassing the read-time access filter. */
const notificationRows = (userId: string, issueId: number) =>
	db
		.select()
		.from(schema.notifications)
		.where(
			and(
				eq(schema.notifications.userId, userId),
				eq(schema.notifications.issueId, issueId),
			),
		);
const subscriptionRows = (userId: string, issueId: number) =>
	db
		.select()
		.from(schema.threadSubscriptions)
		.where(
			and(
				eq(schema.threadSubscriptions.userId, userId),
				eq(schema.threadSubscriptions.issueId, issueId),
			),
		);
let repoId: number;
let privateRepoId: number;

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "n" } })).id;
	privateRepoId = (
		await repositories.createRepository({
			data: { name: "secret", visibility: "private" },
		})
	).id;
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "carol", role: "write" },
	});
});

const inbox = (
	user: (typeof users)[keyof typeof users],
	data: {
		all?: boolean;
		participating?: boolean;
		page?: number;
		per_page?: number;
	} = {},
) => {
	signIn(user);
	return n.getNotifications({ data });
};
const unread = (user: (typeof users)[keyof typeof users]) => {
	signIn(user);
	return n.getUnreadNotificationCount();
};

async function openIssue(
	author: (typeof users)[keyof typeof users],
	title: string,
	body = "",
	repo = repoId,
) {
	signIn(author);
	return issues.createIssue({ data: { repoId: repo, title, body } });
}

describe("notifications", () => {
	it("notifies a mentioned user and never the actor", async () => {
		const issue = await openIssue(
			users.owner,
			"Mention",
			"cc @Bob and @owner, not `@carol` or a@b.com",
		);
		const bob = await inbox(users.bob);
		expect(bob).toHaveLength(1);
		expect(bob[0]).toMatchObject({
			reason: "mention",
			unread: true,
			subject: { type: "Issue", number: issue.number, title: "Mention" },
			repository: { owner: "owner", name: "n" },
		});
		expect(await inbox(users.owner)).toEqual([]);
		expect(await inbox(users.carol)).toEqual([]);
	});

	it("notifies the author and commenters of new comments, one thread each", async () => {
		const issue = await openIssue(users.alice, "Thread");
		signIn(users.bob);
		await comments.createComment({
			data: { issueId: issue.id, body: "first" },
		});
		await comments.createComment({
			data: { issueId: issue.id, body: "second" },
		});
		const alice = (await inbox(users.alice)).filter(
			(x) => x.subject.number === issue.number,
		);
		expect(alice).toHaveLength(1);
		expect(alice[0]?.reason).toBe("author");
		// Bob commented: subscribed, but his own comments don't notify him.
		expect(
			(await inbox(users.bob)).some((x) => x.subject.number === issue.number),
		).toBe(false);

		signIn(users.owner);
		await comments.createComment({
			data: { issueId: issue.id, body: "third" },
		});
		const bob = (await inbox(users.bob)).find(
			(x) => x.subject.number === issue.number,
		);
		expect(bob?.reason).toBe("comment");
	});

	it("marks one or all read and filters unread, all and participating", async () => {
		const issue = await openIssue(users.watcher1, "Read me");
		signIn(users.watcher2);
		await n.setThreadSubscription({
			data: { repoId, number: issue.number, subscribed: true },
		});
		signIn(users.carol);
		await comments.createComment({
			data: { issueId: issue.id, body: "news" },
		});
		const watcher2 = await inbox(users.watcher2);
		expect(watcher2.map((x) => x.reason)).toEqual(["manual"]);
		// Manual subscriptions are not participating.
		expect(await inbox(users.watcher2, { participating: true })).toEqual([]);
		expect(await inbox(users.watcher1, { participating: true })).toHaveLength(
			1,
		);

		const before = await unread(users.watcher2);
		expect(before).toBe(1);
		signIn(users.watcher2);
		await n.markNotificationRead({ data: { id: watcher2[0]?.id ?? 0 } });
		expect(await unread(users.watcher2)).toBe(0);
		expect(await inbox(users.watcher2)).toEqual([]);
		const all = await inbox(users.watcher2, { all: true });
		expect(all).toHaveLength(1);
		expect(all[0]?.unread).toBe(false);
		expect(all[0]?.lastReadAt).toBeInstanceOf(Date);

		// Viewing the thread reads it too (and only reports a change once).
		signIn(users.carol);
		await comments.createComment({
			data: { issueId: issue.id, body: "more" },
		});
		expect(await unread(users.watcher2)).toBe(1);
		signIn(users.watcher2);
		expect(
			await n.markThreadViewed({ data: { repoId, number: issue.number } }),
		).toBe(true);
		expect(await unread(users.watcher2)).toBe(0);
		expect(
			await n.markThreadViewed({ data: { repoId, number: issue.number } }),
		).toBe(false);

		// New activity makes the same thread unread again.
		signIn(users.carol);
		await comments.createComment({
			data: { issueId: issue.id, body: "more" },
		});
		expect(await inbox(users.watcher2, { all: true })).toHaveLength(1);
		expect(await unread(users.watcher2)).toBe(1);

		expect(await unread(users.bob)).toBeGreaterThan(0);
		signIn(users.bob);
		await n.markAllNotificationsRead();
		expect(await unread(users.bob)).toBe(0);
	});

	it("refuses to mark someone else's notification", async () => {
		const [mine] = await inbox(users.watcher2, { all: true });
		signIn(users.alice);
		await expect(
			n.markNotificationRead({ data: { id: mine?.id ?? 0 } }),
		).rejects.toSatisfy(isNotFound);
		expect((await inbox(users.watcher2, { all: true }))[0]?.unread).toBe(true);
	});

	it("stops after an unsubscribe, even when the user comments again", async () => {
		const issue = await openIssue(users.alice, "Quiet");
		signIn(users.alice);
		expect(
			await n.getThreadSubscription({
				data: { repoId, number: issue.number },
			}),
		).toMatchObject({ subscribed: true, reason: "author" });
		await n.setThreadSubscription({
			data: { repoId, number: issue.number, subscribed: false },
		});
		await comments.createComment({
			data: { issueId: issue.id, body: "my own" },
		});
		signIn(users.owner);
		await comments.createComment({
			data: { issueId: issue.id, body: "reply" },
		});
		expect(
			(await inbox(users.alice, { all: true })).some(
				(x) => x.subject.number === issue.number,
			),
		).toBe(false);
	});

	it("notifies new assignees and subscribers of a state change", async () => {
		const issue = await openIssue(users.alice, "Assign");
		signIn(users.owner);
		await assignees.setIssueAssignees({
			data: { issueId: issue.id, usernames: ["carol"] },
		});
		expect(
			(await inbox(users.carol)).find((x) => x.subject.number === issue.number)
				?.reason,
		).toBe("assign");
		signIn(users.carol);
		await n.markAllNotificationsRead();

		signIn(users.owner);
		await issues.updateIssue({ data: { issueId: issue.id, status: "closed" } });
		const carol = (await inbox(users.carol)).find(
			(x) => x.subject.number === issue.number,
		);
		expect(carol).toMatchObject({ reason: "assign", unread: true });
		expect(carol?.subject.state).toBe("closed");
		expect(
			(await inbox(users.alice)).find((x) => x.subject.number === issue.number)
				?.reason,
		).toBe("author");
	});

	it("notifies only new mentions when a body is edited", async () => {
		const issue = await openIssue(users.alice, "Edit", "hi @watcher3");
		signIn(users.watcher3);
		await n.markAllNotificationsRead();
		signIn(users.alice);
		await issues.updateIssue({
			data: { issueId: issue.id, body: "hi @watcher3 and @watcher4" },
		});
		expect(await unread(users.watcher3)).toBe(0);
		expect((await inbox(users.watcher4))[0]?.reason).toBe("mention");
	});

	it("never notifies someone who can't read a private repository", async () => {
		const issue = await openIssue(
			users.owner,
			"Private",
			"@eve look",
			privateRepoId,
		);
		expect(await unread(users.eve)).toBe(0);
		signIn(users.eve);
		await expect(
			n.setThreadSubscription({
				data: {
					repoId: privateRepoId,
					number: issue.number,
					subscribed: true,
				},
			}),
		).rejects.toSatisfy(isNotFound);
	});

	it("writes no notification or subscription for a mentioned non-reader", async () => {
		const issue = await openIssue(
			users.owner,
			"Private mention",
			"@eve see this",
			privateRepoId,
		);
		expect(await notificationRows(users.eve.id, issue.id)).toEqual([]);
		expect(await subscriptionRows(users.eve.id, issue.id)).toEqual([]);

		// Granted access later, she isn't subscribed by the old mention.
		signIn(users.owner);
		await repositories.addCollaboratorByUsername({
			data: { repoId: privateRepoId, username: "eve", role: "read" },
		});
		await comments.createComment({
			data: { issueId: issue.id, body: "later" },
		});
		expect(await notificationRows(users.eve.id, issue.id)).toEqual([]);
		expect(await inbox(users.eve, { all: true })).toEqual([]);
		signIn(users.owner);
		await repositories.removeCollaborator({
			data: { repoId: privateRepoId, userId: users.eve.id },
		});
	});

	it("hides and stops notifications once a collaborator is removed", async () => {
		signIn(users.owner);
		await repositories.addCollaboratorByUsername({
			data: { repoId: privateRepoId, username: "frank", role: "read" },
		});
		const issue = await openIssue(
			users.owner,
			"For frank",
			"@frank please",
			privateRepoId,
		);
		expect(await inbox(users.frank, { all: true })).toHaveLength(1);
		expect(await unread(users.frank)).toBe(1);
		const [before] = await notificationRows(users.frank.id, issue.id);

		signIn(users.owner);
		await repositories.removeCollaborator({
			data: { repoId: privateRepoId, userId: users.frank.id },
		});
		expect(await inbox(users.frank, { all: true })).toEqual([]);
		expect(await unread(users.frank)).toBe(0);

		// Still subscribed, but new activity writes nothing for him.
		signIn(users.owner);
		await comments.createComment({
			data: { issueId: issue.id, body: "after removal" },
		});
		const [after] = await notificationRows(users.frank.id, issue.id);
		expect(after?.updatedAt).toEqual(before?.updatedAt);
	});

	it("hides notifications once a repository goes private", async () => {
		signIn(users.owner);
		const flipId = (
			await repositories.createRepository({ data: { name: "flip" } })
		).id;
		await openIssue(users.owner, "Public now", "@gina hi", flipId);
		expect(await inbox(users.gina, { all: true })).toHaveLength(1);
		expect(await unread(users.gina)).toBe(1);

		signIn(users.owner);
		await repositories.updateRepository({
			data: { id: flipId, visibility: "private" },
		});
		expect(await inbox(users.gina, { all: true })).toEqual([]);
		expect(await unread(users.gina)).toBe(0);
	});

	it("notifies subscribers of issues a merged pull request closes", async () => {
		signIn(users.owner);
		await files.uploadFile({
			data: {
				repoId,
				branchName: "main",
				path: "a.txt",
				content: btoa("one\n"),
				commitMessage: "Initial",
			},
		});
		const issue = await openIssue(users.alice, "Closed by PR");
		signIn(users.alice);
		await n.markAllNotificationsRead();

		signIn(users.carol);
		await files.createBranch({ data: { repoId, name: "fix" } });
		await files.uploadFile({
			data: {
				repoId,
				branchName: "fix",
				path: "a.txt",
				content: btoa("two\n"),
				commitMessage: "Fix",
			},
		});
		const pr = await pulls.createPullRequest({
			data: {
				repoId,
				title: "Fix it",
				body: `Closes #${issue.number}`,
				sourceBranchName: "fix",
				targetBranchName: "main",
			},
		});
		signIn(users.owner);
		await pulls.mergePullRequest({ data: { prId: pr.id } });

		const alice = (await inbox(users.alice)).find(
			(x) => x.subject.number === issue.number,
		);
		expect(alice).toMatchObject({
			reason: "author",
			unread: true,
			subject: { state: "closed" },
		});
	});

	it("pages the inbox with bounded page and per_page", async () => {
		for (const title of ["p1", "p2", "p3"]) {
			await openIssue(users.owner, title, "@pager");
		}
		const first = await inbox(users.pager, { per_page: 2 });
		const second = await inbox(users.pager, { per_page: 2, page: 2 });
		expect(first.map((x) => x.subject.title)).toEqual(["p3", "p2"]);
		expect(second.map((x) => x.subject.title)).toEqual(["p1"]);
		await expect(inbox(users.pager, { per_page: 51 })).rejects.toThrow();
		await expect(inbox(users.pager, { page: 0 })).rejects.toThrow();
		await expect(inbox(users.pager, { page: 100_000 })).rejects.toThrow();
	});

	it("agrees with repo-access.ts on who can read", async () => {
		signIn(users.owner);
		const pinId = (
			await repositories.createRepository({
				data: { name: "pin", visibility: "private" },
			})
		).id;
		const roles = { alice: "read", bob: "write", carol: "admin" } as const;
		for (const [username, role] of Object.entries(roles)) {
			await repositories.addCollaboratorByUsername({
				data: { repoId: pinId, username, role },
			});
		}
		for (const visibility of ["private", "public"] as const) {
			signIn(users.owner);
			await repositories.updateRepository({ data: { id: pinId, visibility } });
			for (const u of [
				users.owner,
				users.alice,
				users.bob,
				users.carol,
				users.eve,
			]) {
				const expected =
					(await getRepositoryAccess(pinId, u.id))?.canRead ?? false;
				const rows = await db
					.select({ id: userTable.id })
					.from(userTable)
					.where(
						and(
							eq(userTable.id, u.id),
							canReadRepositoryCondition(userTable.id, sql`${pinId}`),
						),
					);
				expect([visibility, u.username, rows.length === 1]).toEqual([
					visibility,
					u.username,
					expected,
				]);
			}
		}
	});

	it("needs a signed-in user", async () => {
		signOut();
		expect(await n.getUnreadNotificationCount()).toBe(0);
		await expect(n.getNotifications({ data: {} })).rejects.toThrow(
			"Unauthorized",
		);
	});

	it("records with a fixed number of queries, however many subscribers", async () => {
		const issue = await openIssue(users.owner, "Busy");
		const commentQueries = async () => {
			signIn(users.owner);
			const before = queries.count;
			await comments.createComment({
				data: { issueId: issue.id, body: "@alice @bob ping" },
			});
			return queries.count - before;
		};
		const few = await commentQueries();
		for (const watcher of [
			users.watcher1,
			users.watcher2,
			users.watcher3,
			users.watcher4,
			users.carol,
		]) {
			signIn(watcher);
			await n.setThreadSubscription({
				data: { repoId, number: issue.number, subscribed: true },
			});
		}
		expect(await commentQueries()).toBe(few);
		expect(
			(await inbox(users.watcher4)).some(
				(x) => x.subject.number === issue.number,
			),
		).toBe(true);
	});
});
