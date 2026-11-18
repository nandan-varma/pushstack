/**
 * @vitest-environment node
 *
 * `push` webhook events: one event per accepted ref update, the payload's
 * commit list (oldest first, with the paths each commit changed), `forced`
 * from the ancestry check, created/deleted refs, tags, and a hook that is not
 * active receiving nothing. Deliveries are recorded by a test transport.
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
const { db } = await import("#/db");
const { repositories, webhooks } = await import("#/db/app-schema");
const { eq } = await import("drizzle-orm");
const users = await createUsers("alice");
const { createRepository } = await import("../repositories");
const { createBranch, createCommit } = await import("../git-write");
const { createWebhook, updateWebhook } = await import("../webhook-store");
const { emitPushEvents } = await import("../webhook-events");

const ZERO = "0".repeat(40);
const REPO = "project";

let repoId: number;
let first: string;
let second: string;
let divergent: string;

function events() {
	return sent.map((entry) => JSON.parse(entry.body) as Record<string, unknown>);
}

async function push(
	updates: { refName: string; oldOid: string; newOid: string }[],
	pusherId: string | null = users.alice.id,
) {
	sent.length = 0;
	await emitPushEvents({
		repoId,
		defaultBranch: "main",
		pusherId,
		updates,
		results: updates.map((update) => ({
			refName: update.refName,
			ok: true,
		})) as never,
	});
	return events();
}

beforeAll(async () => {
	signIn(users.alice);
	await createRepository({
		data: { name: REPO, visibility: "public" },
	});
	const [repo] = await db
		.select({ id: repositories.id })
		.from(repositories)
		.where(eq(repositories.name, REPO));
	if (!repo) throw new Error("Repository was not created");
	repoId = repo.id;
});

describe("push payloads", () => {
	it("sends one event per accepted ref update with commits oldest first", async () => {
		first = await createCommit("alice", REPO, {
			branch: "main",
			message: "Initial commit",
			files: [{ path: "README.md", content: "# Hello\n" }],
			author: { name: "Alice", email: "alice@example.com" },
		});
		second = await createCommit("alice", REPO, {
			branch: "main",
			message: "Add notes",
			files: [
				{ path: "NOTES.md", content: "notes\n" },
				{ path: "README.md", content: "# Hello, world\n" },
			],
			author: { name: "Alice", email: "alice@example.com" },
		});
		await createWebhook(repoId, {
			url: "https://example.com/hook",
			contentType: "json",
			secret: null,
			events: ["push"],
			active: true,
		});

		const [event] = await push([
			{ refName: "refs/heads/main", oldOid: first, newOid: second },
		]);
		expect(sent[0]?.headers["X-GitHub-Event"]).toBe("push");
		expect(event).toMatchObject({
			ref: "refs/heads/main",
			before: first,
			after: second,
			created: false,
			deleted: false,
			forced: false,
			base_ref: null,
		});
		expect(event?.compare).toContain(`/compare/${first}...${second}`);
		const commits = event?.commits as {
			id: string;
			added: string[];
			modified: string[];
			removed: string[];
		}[];
		expect(commits.map((commit) => commit.id)).toEqual([second]);
		expect(commits[0]).toMatchObject({
			added: ["NOTES.md"],
			modified: ["README.md"],
			removed: [],
		});
		expect(event?.head_commit).toMatchObject({ id: second });
		expect(event?.pusher).toEqual({
			name: users.alice.name,
			email: users.alice.email,
		});
		expect(event?.sender).toMatchObject({ login: "alice" });
		expect(event?.repository).toMatchObject({ full_name: "alice/project" });
	});

	it("reports a rewritten tip as forced", async () => {
		await createBranch("alice", REPO, "side", "main");
		divergent = await createCommit("alice", REPO, {
			branch: "side",
			message: "Side commit",
			files: [{ path: "SIDE.md", content: "side\n" }],
			author: { name: "Alice", email: "alice@example.com" },
		});
		const [event] = await push([
			{ refName: "refs/heads/side", oldOid: divergent, newOid: second },
		]);
		expect(event?.forced).toBe(true);
	});

	it("marks a created branch with the zero before and no commits of its own", async () => {
		const [event] = await push([
			{ refName: "refs/heads/feature", oldOid: ZERO, newOid: second },
		]);
		expect(event).toMatchObject({ created: true, before: ZERO, forced: false });
		// The commits the default branch already has are not new ones.
		expect(event?.commits).toEqual([]);
		expect(event?.head_commit).toBeNull();
	});

	it("marks a deleted ref and sends no head commit", async () => {
		const [event] = await push([
			{ refName: "refs/heads/feature", oldOid: second, newOid: ZERO },
		]);
		expect(event).toMatchObject({
			deleted: true,
			after: ZERO,
			forced: false,
			head_commit: null,
			commits: [],
		});
	});

	it("sends one event for each of a branch and a tag pushed together", async () => {
		const pushes = await push([
			{ refName: "refs/heads/main", oldOid: first, newOid: second },
			{ refName: "refs/tags/v1", oldOid: ZERO, newOid: second },
		]);
		expect(pushes.map((event) => event.ref)).toEqual([
			"refs/heads/main",
			"refs/tags/v1",
		]);
		expect(pushes[1]).toMatchObject({ created: true, after: second });
	});

	it("sends nothing to a hook that is not active", async () => {
		const [hook] = await db.select().from(webhooks);
		if (!hook) throw new Error("Hook was not created");
		await updateWebhook(hook, { active: false });
		const pushes = await push([
			{ refName: "refs/heads/main", oldOid: first, newOid: second },
		]);
		expect(pushes).toEqual([]);
	});
});
