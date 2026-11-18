/**
 * @vitest-environment node
 *
 * One webhook delivery: signing, the SSRF gate before a socket exists, the
 * one retry that applies only when no response arrived, the response cap, and
 * the delivery row every outcome leaves behind.
 */
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
	WebhookAttempt,
	WebhookDelivery,
	WebhookTransport,
	WebhookTransportRequest,
} from "../webhook-deliver";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const { db } = await import("#/db");
const { repositories, webhookDeliveries, webhooks } = await import(
	"#/db/app-schema"
);
const { createWebhook } = await import("../webhook-store");
const { deliverWebhook, readResponseBody, webhookSignature } = await import(
	"../webhook-deliver"
);

const users = await createUsers("alice");
let repoId: number;

beforeAll(async () => {
	const [repo] = await db
		.insert(repositories)
		.values({ ownerId: users.alice.id, name: "project" })
		.returning();
	if (!repo) throw new Error("Repository insert returned no row");
	repoId = repo.id;
});

async function hookAt(
	url: string,
	options: { contentType?: "json" | "form"; secret?: string | null } = {},
) {
	return createWebhook(repoId, {
		url,
		contentType: options.contentType ?? "json",
		secret: options.secret ?? null,
		events: ["push"],
		active: true,
	});
}

function deliveryFor(
	hook: Awaited<ReturnType<typeof hookAt>>,
	payload: unknown = { zen: "hello" },
): WebhookDelivery {
	return { hook, event: "ping", action: null, payload };
}

async function rowsFor(hookId: number) {
	return db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.webhookId, hookId));
}

function recordingTransport(attempt: WebhookAttempt) {
	const calls: WebhookTransportRequest[] = [];
	const transport: WebhookTransport = async (request) => {
		calls.push(request);
		return attempt;
	};
	return { transport, calls };
}

describe("webhook signing and body", () => {
	it("matches a known HMAC-SHA256 vector", () => {
		expect(
			webhookSignature("key", "The quick brown fox jumps over the lazy dog"),
		).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
	});

	it("signs the exact bytes it sends and sets GitHub's headers", async () => {
		const hook = await hookAt("https://example.com/hook", {
			secret: "s3cret",
		});
		const { transport, calls } = recordingTransport({
			response: {
				statusCode: 200,
				headers: { "content-type": "text/plain" },
				body: "ok",
			},
		});
		await deliverWebhook(deliveryFor(hook), { transport });
		const [request] = calls;
		expect(request?.headers).toMatchObject({
			"X-GitHub-Event": "ping",
			"X-GitHub-Hook-ID": String(hook.id),
			"X-GitHub-Hook-Installation-Target-ID": String(repoId),
			"X-GitHub-Hook-Installation-Target-Type": "repository",
			"Content-Type": "application/json",
		});
		expect(request?.headers["User-Agent"]).toMatch(
			/^GitHub-Hookshot\/[0-9a-f]+$/,
		);
		expect(request?.headers["X-GitHub-Delivery"]).toMatch(/^[0-9a-f-]{36}$/);
		expect(request?.headers["X-Hub-Signature-256"]).toBe(
			`sha256=${webhookSignature("s3cret", request?.body ?? "")}`,
		);
		const [row] = await rowsFor(hook.id);
		expect(row).toMatchObject({
			event: "ping",
			status: "success",
			statusCode: 200,
			responsePayload: "ok",
			requestPayload: request?.body,
		});
		expect(row?.guid).toBe(request?.headers["X-GitHub-Delivery"]);
	});

	it("sends payload=<json> when content_type is form", async () => {
		const hook = await hookAt("https://example.com/form", {
			contentType: "form",
		});
		const { transport, calls } = recordingTransport({
			response: { statusCode: 204, headers: {}, body: "" },
		});
		await deliverWebhook(deliveryFor(hook, { hook_id: hook.id }), {
			transport,
		});
		const [request] = calls;
		expect(request?.headers["Content-Type"]).toBe(
			"application/x-www-form-urlencoded",
		);
		expect(request?.body.startsWith("payload=")).toBe(true);
		expect(
			JSON.parse(
				decodeURIComponent(request?.body.slice("payload=".length) ?? ""),
			),
		).toEqual({ hook_id: hook.id });
	});
});

describe("the SSRF gate", () => {
	const blocked = [
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.0.1",
		"169.254.169.254",
		"100.64.0.1",
		"192.0.0.1",
		"198.18.0.1",
		"224.0.0.1",
		"240.0.0.1",
		"[::1]",
		"[::]",
		"[fc00::1]",
		"[fe80::1]",
		"[ff02::1]",
		"[::ffff:127.0.0.1]",
	];

	it("rejects every blocked address class before a socket is opened", async () => {
		const hook = await hookAt("https://example.com/hook");
		const transport = vi.fn<WebhookTransport>();
		for (const address of blocked) {
			await deliverWebhook(
				deliveryFor({ ...hook, url: `https://${address}/hook` }),
				{ transport, sleep: async () => {} },
			);
		}
		expect(transport).not.toHaveBeenCalled();
		const rows = await rowsFor(hook.id);
		expect(rows).toHaveLength(blocked.length);
		for (const row of rows) {
			expect(row).toMatchObject({
				status: "failure",
				statusCode: null,
				responsePayload: "Webhook URL resolves to a non-public address",
			});
		}
	});

	it("rejects a host whose DNS answer is private", async () => {
		const hook = await hookAt("https://attacker.example/hook");
		const transport = vi.fn<WebhookTransport>();
		const resolve = vi.fn(async () => [
			{ address: "10.0.0.1", family: 4 },
			{ address: "8.8.8.8", family: 4 },
		]);
		await deliverWebhook(deliveryFor(hook), { transport, resolve });
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(transport).not.toHaveBeenCalled();
	});
});

describe("attempts and the delivery row", () => {
	it("records a 5xx as failed and does not retry it", async () => {
		const hook = await hookAt("https://example.com/fail");
		const { transport, calls } = recordingTransport({
			response: {
				statusCode: 503,
				headers: { server: "receiver" },
				body: "down",
			},
		});
		const sleep = vi.fn(async () => {});
		await deliverWebhook(deliveryFor(hook), { transport, sleep });
		expect(calls).toHaveLength(1);
		expect(sleep).not.toHaveBeenCalled();
		const [row] = await rowsFor(hook.id);
		expect(row).toMatchObject({
			status: "failure",
			statusCode: 503,
			responsePayload: "down",
			responseHeaders: { server: "receiver" },
		});
		const [updated] = await db
			.select()
			.from(webhooks)
			.where(eq(webhooks.id, hook.id));
		expect(updated).toMatchObject({
			lastStatusCode: 503,
			lastStatus: "Service Unavailable",
			lastMessage: null,
		});
	});

	it("retries a connect refusal once and records it once", async () => {
		const hook = await hookAt("https://example.com/refused");
		const { transport, calls } = recordingTransport({
			failure: "connect ECONNREFUSED",
			retryable: true,
		});
		const sleep = vi.fn(async () => {});
		await deliverWebhook(deliveryFor(hook), { transport, sleep });
		expect(calls).toHaveLength(2);
		expect(sleep).toHaveBeenCalledWith(2_000);
		const rows = await rowsFor(hook.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			status: "failure",
			statusCode: null,
			responsePayload: "connect ECONNREFUSED",
		});
	});

	it("retries a timeout but not a policy refusal", async () => {
		const hook = await hookAt("https://example.com/timeout");
		const timeout = recordingTransport({
			failure: "Webhook delivery timed out",
			retryable: true,
		});
		await deliverWebhook(deliveryFor(hook), {
			transport: timeout.transport,
			sleep: async () => {},
		});
		expect(timeout.calls).toHaveLength(2);

		const blocked = recordingTransport({
			failure: "Webhook URL resolves to a non-public address",
			retryable: false,
		});
		await deliverWebhook(
			deliveryFor({ ...hook, url: "https://127.0.0.1/hook" }),
			{ transport: blocked.transport, sleep: async () => {} },
		);
		expect(blocked.calls).toHaveLength(0);
	});
});

describe("bounded response bodies", () => {
	it("truncates a 1 MiB response body at 64 KiB", async () => {
		const body = await readResponseBody(
			Readable.from([Buffer.alloc(1024 * 1024, "a")]),
			64 * 1024,
		);
		expect(body).toHaveLength(64 * 1024);
	});

	it("records a body the transport capped", async () => {
		const hook = await hookAt("https://example.com/big");
		const { transport } = recordingTransport({
			response: {
				statusCode: 200,
				headers: {},
				body: "a".repeat(64 * 1024),
			},
		});
		await deliverWebhook(deliveryFor(hook), { transport });
		const [row] = await rowsFor(hook.id);
		expect(row?.responsePayload).toHaveLength(64 * 1024);
	});
});
