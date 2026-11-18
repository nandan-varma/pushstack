/**
 * @vitest-environment node
 *
 * A branch protection lookup that fails is a failure, never "not protected":
 * the store is stubbed to throw, and both the protection read and the branch
 * JSON must answer 500 rather than a 404 or `protected: false`.
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
vi.mock("../branch-protection-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("../branch-protection-store")>()),
	listBranchProtectionRules: async () => {
		throw new Error("rules unavailable");
	},
	findBranchProtection: async () => {
		throw new Error("rules unavailable");
	},
}));

const { createUsers } = await import("../../test/app-harness");
const users = await createUsers("alice");
const { call, mintToken, post } = await import("../../test/api-client");

beforeAll(async () => {
	const alice = await mintToken(users.alice, ["repo:write"]);
	expect(
		(await call("/user/repos", post(alice, { name: "proj", auto_init: true })))
			.status,
	).toBe(201);
});

describe("a failing protection rule lookup", () => {
	it("is a 500, not a 404", async () => {
		const response = await call("/repos/alice/proj/branches/main/protection");
		expect(response.status).toBe(500);
		expect(response.body.message).toBe("Server Error");
	});

	it("is a 500 for the branch JSON, not protected: false", async () => {
		const branch = await call("/repos/alice/proj/branches/main");
		expect(branch.status).toBe(500);
		const list = await call("/repos/alice/proj/branches");
		expect(list.status).toBe(500);
	});
});
