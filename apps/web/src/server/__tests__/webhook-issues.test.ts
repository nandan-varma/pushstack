/**
 * @vitest-environment node
 *
 * `issues` webhook events: opened from the create write, edited with the
 * previous title, closed with the REST issue state, and labeled with the label
 * object. A hook subscribed to another event receives nothing, and a private
 * repository's admin still receives the payload.
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

const { createUsers } = await import("../../test/app-harness");
const users = await createUsers("alice");
const { call, mintToken, patch, post } = await import("../../test/api-client");
const { createWebhook } = await import("../webhook-store");

let alice: string;

function events() {
	return sent.map(
		(entry) =>
			JSON.parse(entry.body) as {
				action: string;
				issue: {
					number: number;
					title: string;
					state: string;
					user: { login: string };
				};
				repository: { full_name: string };
				changes?: { title?: { from: string } };
				label?: { name: string };
			},
	);
}

async function repoWithHook(name: string, events: string[]) {
	const { body } = await call(
		"/user/repos",
		post(alice, { name, auto_init: true }),
	);
	await createWebhook(body.id, {
		url: "https://example.com/hook",
		contentType: "json",
		secret: null,
		events,
		active: true,
	});
	return body.id as number;
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
});

describe("issue payloads", () => {
	it("sends opened with the issue, repository and sender", async () => {
		await repoWithHook("proj", ["issues"]);
		sent.length = 0;
		const { body } = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Something broke", body: "Details" }),
		);
		const [event] = events();
		expect(sent[0]?.headers["X-GitHub-Event"]).toBe("issues");
		expect(event).toMatchObject({
			action: "opened",
			issue: {
				number: body.number,
				title: "Something broke",
				state: "open",
				user: { login: "alice" },
			},
			repository: { full_name: "alice/proj" },
		});
	});

	it("sends edited with the previous title", async () => {
		sent.length = 0;
		await call(
			"/repos/alice/proj/issues/1",
			patch(alice, { title: "Something else broke" }),
		);
		const [event] = events();
		expect(event?.action).toBe("edited");
		expect(event?.changes?.title).toEqual({ from: "Something broke" });
	});

	it("sends closed with the issue's state", async () => {
		sent.length = 0;
		await call("/repos/alice/proj/issues/1", patch(alice, { state: "closed" }));
		const [event] = events();
		expect(event?.action).toBe("closed");
		expect(event?.issue.state).toBe("closed");
	});

	it("sends labeled with the label object", async () => {
		await call(
			"/repos/alice/proj/labels",
			post(alice, { name: "bug", color: "ff0000" }),
		);
		sent.length = 0;
		await call(
			"/repos/alice/proj/issues/1/labels",
			post(alice, { labels: ["bug"] }),
		);
		const [event] = events();
		expect(event?.action).toBe("labeled");
		expect(event?.label).toMatchObject({ name: "bug" });
	});

	it("sends nothing to a hook subscribed only to push", async () => {
		await repoWithHook("other", ["push"]);
		sent.length = 0;
		await call("/repos/alice/other/issues", post(alice, { title: "No event" }));
		expect(events()).toEqual([]);
	});

	it("delivers a private repository's event to its owner's hook", async () => {
		const { body } = await call(
			"/user/repos",
			post(alice, { name: "secret", private: true, auto_init: true }),
		);
		await createWebhook(body.id, {
			url: "https://example.com/hook",
			contentType: "json",
			secret: null,
			events: ["issues"],
			active: true,
		});
		sent.length = 0;
		await call("/repos/alice/secret/issues", post(alice, { title: "Hidden" }));
		const [event] = events();
		expect(event).toMatchObject({
			action: "opened",
			issue: { title: "Hidden" },
			repository: { full_name: "alice/secret" },
		});
		expect(sent[0]?.headers["X-GitHub-Event"]).toBe("issues");
	});
});
