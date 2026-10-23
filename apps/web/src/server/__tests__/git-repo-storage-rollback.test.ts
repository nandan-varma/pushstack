/**
 * @vitest-environment node
 *
 * A transfer moves the git data and then the release assets. If the second
 * move fails, the first is moved back: the git data and the repository row
 * stay at the old location.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const failing = vi.hoisted(() => ({ releases: false }));

vi.mock("git-fs-s3", async (importOriginal) => {
	const actual = await importOriginal<typeof import("git-fs-s3")>();
	return {
		...actual,
		movePrefix: (...args: Parameters<typeof actual.movePrefix>) => {
			if (failing.releases && String(args[1]).includes("/releases/")) {
				return Promise.reject(new Error("injected releases move failure"));
			}
			return actual.movePrefix(...args);
		},
	};
});
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const { asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);

const users = await createUsers("alice", "bob");
let alice: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
});

describe("transfer when the releases move fails", () => {
	it("leaves the git data and the row at the old location", async () => {
		await call("/user/repos", post(alice, { name: "half", auto_init: true }));
		const release = await call(
			"/repos/alice/half/releases",
			post(alice, { tag_name: "v1" }),
		);
		await call(
			`/repos/alice/half/releases/${release.body.id}/assets?name=a.txt`,
			{
				...asToken(alice),
				method: "POST",
				body: new TextEncoder().encode("payload"),
			},
		);
		const before = (await call("/repos/alice/half/branches/main")).body.commit
			.sha;

		failing.releases = true;
		const failed = await call(
			"/repos/alice/half/transfer",
			post(alice, { new_owner: "bob" }),
		);
		failing.releases = false;
		expect(failed.status).toBeGreaterThanOrEqual(500);

		expect((await call("/repos/bob/half")).status).toBe(404);
		expect((await call("/repos/alice/half")).status).toBe(200);
		expect(
			(await call("/repos/alice/half/branches/main")).body.commit.sha,
		).toBe(before);
		const assets = await call(
			`/repos/alice/half/releases/${release.body.id}/assets`,
		);
		expect(assets.body).toHaveLength(1);

		// And the transfer works once the failure is gone.
		const retried = await call(
			"/repos/alice/half/transfer",
			post(alice, { new_owner: "bob" }),
		);
		expect(retried.status).toBe(202);
		expect((await call("/repos/bob/half/branches/main")).body.commit.sha).toBe(
			before,
		);
	});
});
