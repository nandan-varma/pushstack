/**
 * @vitest-environment node
 *
 * The identity registry and organization ownership: one login namespace for
 * users and organizations, and an org-owned repository whose git data lands
 * under the organization's login.
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
const { addLogin, loginTaken } = await import("../logins-store");
const {
	createOrganization,
	getOrganizationByLogin,
	OrganizationLoginTakenError,
} = await import("../organizations-store");
const { createRepositoryForOwner } = await import("../repository-create");
const { ownerKeyOf } = await import("../git-storage-naming");
const { isOrgOwned, repoOwnerOf } = await import("../repo-access");
const { getBranches, getCommit } = await import("../git-read");

const users = await createUsers("alice");

describe("the login registry", () => {
	beforeAll(async () => {
		await createOrganization({ login: "acme" });
	});

	it("refuses an organization login that is a case variant of a username", async () => {
		await expect(createOrganization({ login: "ALICE" })).rejects.toBeInstanceOf(
			OrganizationLoginTakenError,
		);
	});

	it("refuses a user login that is a case variant of an organization's", async () => {
		await expect(loginTaken("AcMe")).resolves.toBe(true);
		await expect(loginTaken(users.alice.username)).resolves.toBe(true);
		await expect(
			addLogin({ login: "ACME", kind: "user", refId: "someone" }),
		).rejects.toMatchObject({ cause: { code: "23505" } });
	});

	it("finds an organization by any case of its login", async () => {
		await expect(getOrganizationByLogin("aCmE")).resolves.toMatchObject({
			login: "acme",
		});
		await expect(getOrganizationByLogin("../etc")).resolves.toBeNull();
	});
});

describe("an organization-owned repository", () => {
	it("stores its git data under the organization login", async () => {
		const organization = await getOrganizationByLogin("acme");
		if (!organization) throw new Error("acme missing");
		const repo = await createRepositoryForOwner(
			{
				kind: "organization",
				id: organization.id,
				login: organization.login,
				name: "Acme",
				email: "acme@example.com",
			},
			{ name: "widgets", visibility: "public", autoInit: true },
		);
		expect(repo.ownerId).toBeNull();
		expect(isOrgOwned(repo)).toBe(true);
		expect(ownerKeyOf({ owner: repoOwnerOf({ ...repo, organization }) })).toBe(
			"acme",
		);

		expect(await getBranches("acme", "widgets")).toContainEqual(
			expect.objectContaining({ name: "main" }),
		);
		const commit = await getCommit("acme", "widgets", "refs/heads/main");
		expect(commit.commit.message.trim()).toBe("Initial commit");
	});
});
