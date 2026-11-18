/**
 * @vitest-environment node
 *
 * `pull_request` webhook events: opened from the create write, edited and
 * closed/reopened from an update, the draft toggles, `synchronize` from the
 * push seam (one per open pull request headed by the updated branch), and a
 * merge's `closed` carrying the real merge commit. Deliveries are recorded by
 * a test transport.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { WebhookTransport } from "../webhook-deliver";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const sent: { body: string; headers: Record<string, string> }[] = [];
vi.mock("../webhook-deliver", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../webhook-deliver")>();
	const transport: WebhookTransport = async (request) => {
		sent.push({ body: request.body, headers: request.headers });
		return { response: { statusCode: 200, headers: {}, body: "ok" } };
	};
	return {
		...actual,
		deliverWebhook: (
			delivery: Parameters<typeof actual.deliverWebhook>[0],
			deps: Parameters<typeof actual.deliverWebhook>[1] = {},
		) =>
			actual.deliverWebhook(delivery, {
				resolve: async () => [{ address: "93.184.216.34", family: 4 }],
				transport,
				...deps,
			}),
	};
});

const { createUsers, signIn } = await import("../../test/app-harness");
const users = await createUsers("alice");
const { BASE, asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const files = await import("../files");
const { createWebhook } = await import("../webhook-store");
const { emitPullRequestSynchronizations } = await import("../webhook-events");
const { setPullRequestDraftState } = await import("../pull-requests");

let alice: string;
let repoId: number;

function events() {
	return sent.map(
		(entry) =>
			JSON.parse(entry.body) as {
				action: string;
				number: number;
				pull_request: Record<string, unknown> & {
					base: { ref: string; repo: { full_name: string } };
					head: { sha: string };
					merged: boolean;
					merge_commit_sha: string | null;
				};
				changes?: Record<string, { from: string }>;
			},
	);
}

async function commitFile(branch: string, path: string) {
	signIn(users.alice);
	await files.uploadFile({
		data: {
			repoId,
			branchName: branch,
			path,
			content: btoa(`${path}\n`),
			commitMessage: `Add ${path}`,
		},
	});
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	const created = await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	repoId = created.body.id;
	await createWebhook(repoId, {
		url: "https://example.com/hook",
		contentType: "json",
		secret: null,
		events: ["pull_request"],
		active: true,
	});
	signIn(users.alice);
	await files.createBranch({ data: { repoId, name: "topic" } });
	await commitFile("topic", "b.txt");
});

describe("pull_request payloads", () => {
	it("sends opened with the REST pull object's base and head", async () => {
		sent.length = 0;
		const { body } = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "Add b", head: "topic", base: "main" }),
		);
		const [event] = events();
		expect(sent[0]?.headers["X-GitHub-Event"]).toBe("pull_request");
		expect(event).toMatchObject({
			action: "opened",
			number: body.number,
			pull_request: {
				base: { ref: "main" },
				head: { ref: "topic", sha: body.head.sha },
				merged: false,
				draft: false,
				commits: 1,
				changed_files: 1,
			},
		});
		expect(event?.pull_request.base.repo).toMatchObject({
			full_name: "alice/proj",
		});
	});

	it("sends synchronize for the pushed head branch and nothing else", async () => {
		sent.length = 0;
		const branchTip = (
			await call("/repos/alice/proj/git/ref/heads/topic", asToken(alice))
		).body.object.sha as string;
		await emitPullRequestSynchronizations({
			repoId,
			defaultBranch: "main",
			pusherId: users.alice.id,
			updates: [
				{ refName: "refs/heads/topic", oldOid: branchTip, newOid: branchTip },
			],
			results: [{ refName: "refs/heads/topic", ok: true }] as never,
		});
		const delivered = events();
		expect(delivered.map((event) => event.action)).toEqual(["synchronize"]);
		expect(delivered[0]?.pull_request.head.sha).toBe(branchTip);
	});

	it("sends ready_for_review then converted_to_draft on a draft toggle", async () => {
		const { body } = await call("/repos/alice/proj/pulls/1", asToken(alice));
		sent.length = 0;
		await setPullRequestDraftState({
			data: { prId: body.id, draft: true },
		});
		await setPullRequestDraftState({
			data: { prId: body.id, draft: false },
		});
		expect(events().map((event) => event.action)).toEqual([
			"converted_to_draft",
			"ready_for_review",
		]);
	});

	it("sends edited with the previous title", async () => {
		sent.length = 0;
		await call(
			"/repos/alice/proj/pulls/1",
			patch(alice, { title: "Add b, edited" }),
		);
		const [event] = events();
		expect(event?.action).toBe("edited");
		expect(event?.changes?.title).toEqual({ from: "Add b" });
	});

	it("sends closed with merged and the real merge commit", async () => {
		sent.length = 0;
		const { status } = await call("/repos/alice/proj/pulls/1/merge", {
			...asToken(alice),
			method: "PUT",
			body: JSON.stringify({ merge_method: "squash" }),
		});
		expect(status).toBe(200);
		const [event] = events();
		expect(event?.action).toBe("closed");
		expect(event?.pull_request.merged).toBe(true);
		expect(event?.pull_request.merge_commit_sha).toMatch(/^[0-9a-f]{40}$/);
	});

	it("sends nothing to a hook subscribed only to issues", async () => {
		const hooks = await import("#/db").then(({ db }) =>
			import("#/db/app-schema").then(({ webhooks }) =>
				db.select().from(webhooks),
			),
		);
		const hook = hooks[0];
		if (!hook) throw new Error("Hook missing");
		const { updateWebhook } = await import("../webhook-store");
		await updateWebhook(hook, { events: ["issues"] });
		sent.length = 0;
		await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "Another", head: "topic", base: "main" }),
		);
		expect(events()).toEqual([]);
	});
});

describe("synchronize scope", () => {
	it("does not send for a pull request of another repository", async () => {
		const created = await call(
			"/user/repos",
			post(alice, { name: "other", auto_init: true }),
		);
		const otherId = created.body.id as number;
		signIn(users.alice);
		await files.createBranch({ data: { repoId: otherId, name: "topic" } });
		await files.uploadFile({
			data: {
				repoId: otherId,
				branchName: "topic",
				path: "c.txt",
				content: btoa("c\n"),
				commitMessage: "Add c",
			},
		});
		await call(
			"/repos/alice/other/pulls",
			post(alice, { title: "Other", head: "topic", base: "main" }),
		);
		await createWebhook(repoId, {
			url: "https://example.com/hook",
			contentType: "json",
			secret: null,
			events: ["pull_request"],
			active: true,
		});
		sent.length = 0;
		await emitPullRequestSynchronizations({
			repoId,
			defaultBranch: "main",
			pusherId: users.alice.id,
			updates: [{ refName: "refs/heads/topic", oldOid: "a", newOid: "b" }],
			results: [{ refName: "refs/heads/topic", ok: true }] as never,
		});
		// Only this repository's pull requests: one event, not one per repository.
		expect(events()).toHaveLength(1);
		expect(BASE).toContain("/api/v3");
	});
});
