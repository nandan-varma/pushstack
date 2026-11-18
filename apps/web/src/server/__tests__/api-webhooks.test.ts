/**
 * @vitest-environment node
 *
 * Repository webhooks over the REST API: GitHub's hook CRUD and the config
 * sub-resource, the per-event cap, and the access rules — a repository the
 * caller can't read is a 404 and a collaborator without admin is a 403. A
 * stored secret is never returned.
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

const { createUsers } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob", "carol");
const { BASE, asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { db } = await import("#/db");
const { repositories, repositoryCollaborators } = await import(
	"#/db/app-schema"
);
const { eq } = await import("drizzle-orm");
const { MAX_HOOKS_PER_EVENT } = await import("#/lib/limits");

let alice: string;
let bob: string;
let carol: string;

const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

const hookBody = (extra: Record<string, unknown> = {}) => ({
	name: "web",
	active: true,
	events: ["push"],
	config: { url: "https://example.com/hook", content_type: "json" },
	...extra,
});

async function createHook(
	owner: string,
	repo: string,
	token: string,
	extra: Record<string, unknown> = {},
) {
	return call(`/repos/${owner}/${repo}/hooks`, post(token, hookBody(extra)));
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "project" }));
	await call("/user/repos", post(alice, { name: "other" }));
	await call("/user/repos", post(alice, { name: "hidden", private: true }));
	await call("/user/repos", post(alice, { name: "limits" }));
	const [project] = await db
		.select({ id: repositories.id })
		.from(repositories)
		.where(eq(repositories.name, "project"));
	await db.insert(repositoryCollaborators).values({
		repoId: project?.id ?? 0,
		userId: users.bob.id,
		role: "read",
	});
});

describe("creating a repository webhook", () => {
	it("answers 201 with a Location and never the secret", async () => {
		const { status, headers, body } = await createHook(
			"alice",
			"project",
			alice,
			{
				config: {
					url: "https://example.com/hook",
					content_type: "json",
					secret: "s3cret",
				},
			},
		);
		expect(status).toBe(201);
		expect(headers.get("location")).toBe(
			`${BASE}/repos/alice/project/hooks/${body.id}`,
		);
		expect(body).toMatchObject({
			type: "Repository",
			name: "web",
			active: true,
			events: ["push"],
			config: {
				content_type: "json",
				insecure_ssl: "0",
				secret: "********",
				url: "https://example.com/hook",
			},
			url: `${BASE}/repos/alice/project/hooks/${body.id}`,
			test_url: `${BASE}/repos/alice/project/hooks/${body.id}/test`,
			ping_url: `${BASE}/repos/alice/project/hooks/${body.id}/pings`,
			deliveries_url: `${BASE}/repos/alice/project/hooks/${body.id}/deliveries`,
			// Nothing is delivered yet, so there is no last response.
			last_response: { code: null, status: null, message: null },
		});
		expect(JSON.stringify(body)).not.toContain("s3cret");
		const listed = await call("/repos/alice/project/hooks", asToken(alice));
		expect(JSON.stringify(listed.body)).not.toContain("s3cret");
	});

	it("defaults events to push and content_type to form, like GitHub", async () => {
		const { status, body } = await createHook("alice", "project", alice, {
			events: undefined,
			config: { url: "https://example.com/form" },
		});
		expect(status).toBe(201);
		expect(body.events).toEqual(["push"]);
		expect(body.config).toMatchObject({
			content_type: "form",
			secret: "",
		});
	});

	it("refuses a non-https URL, an unknown event and insecure_ssl 1", async () => {
		const http = await createHook("alice", "project", alice, {
			config: { url: "http://example.com/hook" },
		});
		expect(http.status).toBe(422);
		expect(http.body.errors[0]).toMatchObject({
			resource: "Hook",
			field: "config",
		});

		const event = await createHook("alice", "limits", alice, {
			events: ["push", "not_an_event"],
		});
		expect(event.status).toBe(422);
		expect(event.body.errors[0]).toMatchObject({
			resource: "Hook",
			field: "events",
		});

		const insecure = await createHook("alice", "project", alice, {
			config: { url: "https://example.com/hook", insecure_ssl: "1" },
		});
		expect(insecure.status).toBe(422);
		expect(insecure.body.errors[0]).toMatchObject({
			resource: "Hook",
			field: "config",
		});
	});

	it("refuses the 21st hook for one event type", async () => {
		for (let index = 0; index < MAX_HOOKS_PER_EVENT; index += 1) {
			const created = await createHook("alice", "limits", alice, {
				events: ["issues"],
			});
			expect(created.status).toBe(201);
		}
		const refused = await createHook("alice", "limits", alice, {
			events: ["issues", "push"],
		});
		expect(refused.status).toBe(422);
		expect(refused.body.errors).toEqual([
			expect.objectContaining({
				resource: "Hook",
				field: "events",
				code: "custom",
			}),
		]);
		// Another event type still has room.
		const allowed = await createHook("alice", "limits", alice, {
			events: ["push"],
		});
		expect(allowed.status).toBe(201);
	});
});

describe("updating and deleting a repository webhook", () => {
	it("merges events, keeps an untouched secret and clears an omitted one", async () => {
		const { body: created } = await createHook("alice", "other", alice, {
			events: ["push"],
			config: {
				url: "https://example.com/hook",
				content_type: "json",
				secret: "s3cret",
			},
		});
		const path = `/repos/alice/other/hooks/${created.id}`;

		const inactive = await call(path, patch(alice, { active: false }));
		expect(inactive.status).toBe(200);
		expect(inactive.body.active).toBe(false);
		// No `config` in the patch leaves the stored secret alone.
		expect(inactive.body.config.secret).toBe("********");

		const added = await call(
			path,
			patch(alice, { add_events: ["issues"], remove_events: ["push"] }),
		);
		expect(added.body.events).toEqual(["issues"]);

		const replaced = await call(
			path,
			patch(alice, { events: ["pull_request", "issues"] }),
		);
		expect(replaced.body.events).toEqual(["pull_request", "issues"]);

		// A `config` object without a secret clears the stored one, as on GitHub.
		const cleared = await call(
			path,
			patch(alice, { config: { content_type: "form" } }),
		);
		expect(cleared.body.config).toMatchObject({
			content_type: "form",
			secret: "",
			url: "https://example.com/hook",
		});
	});

	it("reads and updates the config sub-resource", async () => {
		const { body: created } = await createHook("alice", "other", alice, {
			config: {
				url: "https://example.com/hook",
				content_type: "json",
				secret: "s3cret",
			},
		});
		const path = `/repos/alice/other/hooks/${created.id}/config`;

		const read = await call(path, asToken(alice));
		expect(read.status).toBe(200);
		expect(read.body).toMatchObject({
			content_type: "json",
			insecure_ssl: "0",
			secret: "********",
			url: "https://example.com/hook",
		});

		const updated = await call(
			path,
			patch(alice, {
				url: "https://example.com/moved",
				secret: "rotated",
			}),
		);
		expect(updated.body).toMatchObject({
			secret: "********",
			url: "https://example.com/moved",
		});

		const cleared = await call(path, patch(alice, { content_type: "form" }));
		expect(cleared.body).toMatchObject({
			content_type: "form",
			secret: "",
			url: "https://example.com/moved",
		});
	});

	it("deletes with 204 and then 404s", async () => {
		const { body: created } = await createHook("alice", "project", alice);
		const path = `/repos/alice/project/hooks/${created.id}`;
		expect((await call(path, del(alice))).status).toBe(204);
		expect((await call(path, asToken(alice))).status).toBe(404);
		expect((await call(path, del(alice))).status).toBe(404);
	});

	it("404s a hook through another repository's path", async () => {
		const { body: created } = await createHook("alice", "project", alice);
		expect(
			(await call(`/repos/alice/other/hooks/${created.id}`, asToken(alice)))
				.status,
		).toBe(404);
	});
});

describe("webhook access", () => {
	it("404s a private repository the caller cannot read", async () => {
		expect(
			(await call("/repos/alice/hidden/hooks", post(carol, hookBody()))).status,
		).toBe(404);
		expect(
			(await call("/repos/alice/hidden/hooks", asToken(carol))).status,
		).toBe(404);
	});

	it("403s a collaborator without admin", async () => {
		const listed = await call("/repos/alice/project/hooks", asToken(bob));
		expect(listed.status).toBe(403);
		expect(listed.body.message).toBe("Must have admin rights to Repository.");
		const created = await createHook("alice", "project", bob);
		expect(created.status).toBe(403);
	});

	it("needs a token", async () => {
		expect((await call("/repos/alice/project/hooks")).status).toBe(401);
	});
});
