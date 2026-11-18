/**
 * @vitest-environment node
 *
 * The webhook delivery log over the REST API: `cursor` paging (never `page`),
 * the `status` code filter, the single-delivery read, and redelivery from the
 * stored bytes. A delivery of another hook or repository is a 404, and a
 * payload that was not retained cannot be redelivered (422).
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
// The same delivery code, with a recording transport: a redelivery must not
// reach the network and must still write its own row.
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

const { createUsers } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { BASE, asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);
const { db } = await import("#/db");
const { repositories, webhookDeliveries, webhooks } = await import(
	"#/db/app-schema"
);
const { eq } = await import("drizzle-orm");

let alice: string;
let bob: string;

const hookBody = (url = "https://example.com/hook") => ({
	name: "web",
	active: true,
	events: ["push"],
	config: { url, content_type: "json" },
});

async function hookIn(repo: string, token: string, url?: string) {
	const { body } = await call(
		`/repos/alice/${repo}/hooks`,
		post(token, hookBody(url)),
	);
	return body.id as number;
}

function deliveryRecord(
	webhookId: number,
	extra: Partial<typeof webhookDeliveries.$inferInsert> = {},
): typeof webhookDeliveries.$inferInsert {
	return {
		webhookId,
		guid: crypto.randomUUID(),
		event: "push",
		action: null,
		requestHeaders: { "X-GitHub-Event": "push" },
		requestPayload: '{"ref":"refs/heads/main"}',
		status: "success",
		statusCode: 200,
		responseHeaders: { "content-type": "text/plain" },
		responsePayload: "ok",
		durationMs: 5,
		redelivery: false,
		...extra,
	};
}

async function insert(webhookId: number, extra = {}) {
	const [row] = await db
		.insert(webhookDeliveries)
		.values(deliveryRecord(webhookId, extra))
		.returning();
	if (!row) throw new Error("Delivery insert returned no row");
	return row;
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "project" }));
	await call("/user/repos", post(alice, { name: "other" }));
});

describe("listing webhook deliveries", () => {
	it("pages by cursor, newest first, without repeating or skipping a row", async () => {
		const hookId = await hookIn("project", alice);
		const rows = [];
		for (let i = 0; i < 5; i += 1) rows.push(await insert(hookId));

		const first = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries?per_page=2`,
			asToken(alice),
		);
		expect(first.status).toBe(200);
		expect(first.body.map((d: { id: number }) => d.id)).toEqual([
			rows[4]?.id,
			rows[3]?.id,
		]);
		const link = first.headers.get("link") ?? "";
		expect(link).toContain(`cursor=${rows[3]?.id}`);
		expect(link).toContain('rel="next"');
		expect(link).not.toMatch(/[?&]page=/);

		// Newer rows arrive between the pages; the older page is unaffected.
		await insert(hookId);
		await insert(hookId);

		const cursor = new URL(link.slice(1, link.indexOf(">"))).search;
		const second = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries${cursor}`,
			asToken(alice),
		);
		expect(second.body.map((d: { id: number }) => d.id)).toEqual([
			rows[2]?.id,
			rows[1]?.id,
		]);
	});

	it("returns the delivery fields GitHub's list documents", async () => {
		const hookId = await hookIn("project", alice);
		const row = await insert(hookId, { event: "issues", action: "opened" });
		const [repo] = await db
			.select({ id: repositories.id })
			.from(repositories)
			.where(eq(repositories.name, "project"));
		const { body } = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries`,
			asToken(alice),
		);
		expect(body[0]).toEqual({
			id: row.id,
			guid: row.guid,
			delivered_at: row.deliveredAt.toISOString().replace(/\.\d+Z$/, "Z"),
			redelivery: false,
			duration: 5,
			status: "success",
			status_code: 200,
			event: "issues",
			action: "opened",
			repository_id: repo?.id,
			installation_id: null,
			throttled_at: null,
		});
	});

	it("filters by status code range and refuses an unknown status", async () => {
		const hookId = await hookIn("project", alice);
		const ok = await insert(hookId, { statusCode: 204 });
		const failed = await insert(hookId, {
			status: "failure",
			statusCode: 500,
		});
		await insert(hookId, { status: "failure", statusCode: null });

		const success = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries?status=success`,
			asToken(alice),
		);
		expect(success.body.map((d: { id: number }) => d.id)).toEqual([ok.id]);
		const failure = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries?status=failure`,
			asToken(alice),
		);
		expect(failure.body.map((d: { id: number }) => d.id)).toEqual([failed.id]);

		const unknown = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries?status=maybe`,
			asToken(alice),
		);
		expect(unknown.status).toBe(422);
		const badCursor = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries?cursor=abc`,
			asToken(alice),
		);
		expect(badCursor.status).toBe(422);
	});
});

describe("reading one delivery", () => {
	it("returns its request and response payloads", async () => {
		const hookId = await hookIn("project", alice);
		const row = await insert(hookId);
		const { status, body } = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries/${row.id}`,
			asToken(alice),
		);
		expect(status).toBe(200);
		expect(body.url).toBe(
			`${BASE}/repos/alice/project/hooks/${hookId}/deliveries/${row.id}`,
		);
		expect(body.request).toEqual({
			headers: { "X-GitHub-Event": "push" },
			payload: '{"ref":"refs/heads/main"}',
		});
		expect(body.response).toEqual({
			headers: { "content-type": "text/plain" },
			payload: "ok",
		});
	});

	it("is a 404 for a delivery of another hook or repository", async () => {
		const hookId = await hookIn("project", alice);
		const otherHook = await hookIn("project", alice);
		const row = await insert(otherHook);
		const wrongHook = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries/${row.id}`,
			asToken(alice),
		);
		expect(wrongHook.status).toBe(404);

		const otherRepoHook = await hookIn("other", alice);
		const wrongRepo = await call(
			`/repos/alice/other/hooks/${otherRepoHook}/deliveries/${row.id}`,
			asToken(alice),
		);
		expect(wrongRepo.status).toBe(404);
	});
});

describe("redelivering a delivery", () => {
	it("sends the stored bytes and records a second row with a new guid", async () => {
		const hookId = await hookIn("project", alice);
		const row = await insert(hookId);
		sent.length = 0;

		const { status, body } = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries/${row.id}/attempts`,
			post(alice, {}),
		);
		expect(status).toBe(202);
		expect(body).toEqual({});
		expect(sent.map((entry) => entry.body)).toEqual([row.requestPayload]);

		const rows = await db
			.select()
			.from(webhookDeliveries)
			.where(eq(webhookDeliveries.webhookId, hookId));
		expect(rows).toHaveLength(2);
		const redelivered = rows.find((candidate) => candidate.id !== row.id);
		expect(redelivered).toMatchObject({
			redelivery: true,
			event: row.event,
			requestPayload: row.requestPayload,
			status: "success",
		});
		expect(redelivered?.guid).not.toBe(row.guid);
		expect(sent[0]?.headers["X-GitHub-Delivery"]).toBe(redelivered?.guid);
	});

	it("is a 422 when the payload was not retained", async () => {
		const hookId = await hookIn("project", alice);
		const row = await insert(hookId, { requestPayload: null });
		const { status } = await call(
			`/repos/alice/project/hooks/${hookId}/deliveries/${row.id}/attempts`,
			post(alice, {}),
		);
		expect(status).toBe(422);
		const rows = await db
			.select()
			.from(webhookDeliveries)
			.where(eq(webhookDeliveries.webhookId, hookId));
		expect(rows).toHaveLength(1);
	});
});

describe("access", () => {
	it("hides the delivery log of a repository the caller cannot read", async () => {
		const [repo] = await db
			.insert(repositories)
			.values({
				ownerId: users.alice.id,
				name: "private-one",
				visibility: "private",
			})
			.returning();
		const [hook] = await db
			.insert(webhooks)
			.values({
				repoId: repo?.id ?? 0,
				url: "https://example.com/hook",
				contentType: "json",
				events: ["push"],
			})
			.returning();
		const { status } = await call(
			`/repos/alice/private-one/hooks/${hook?.id}/deliveries`,
			asToken(alice),
		);
		expect(status).toBe(200);
		const stranger = await call(
			`/repos/alice/private-one/hooks/${hook?.id}/deliveries`,
			asToken(bob),
		);
		expect(stranger.status).toBe(404);
	});
});
