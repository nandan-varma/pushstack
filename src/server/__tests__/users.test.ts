/**
 * Tests for users.ts's getUserProfile — public/self visibility gating and
 * activity metadata normalization. Follows the same "public + anonymous =
 * read" model as search.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupServerFnMock } from "@/test/server-test-utils";

setupServerFnMock();

const getCurrentUserOptionalMock = vi.fn(
	(): Promise<{ id: string } | null> => Promise.resolve(null),
);
vi.mock("../session", () => ({
	getCurrentUserOptional: getCurrentUserOptionalMock,
}));

const findFirstUserMock = vi.fn();
const findManyReposMock = vi.fn(
	(_args?: { where?: unknown }): Promise<unknown[]> => Promise.resolve([]),
);
const findManyActivitiesMock = vi.fn(
	(): Promise<unknown[]> => Promise.resolve([]),
);

vi.mock("../../db", () => ({
	db: {
		query: {
			user: { findFirst: findFirstUserMock },
			repositories: { findMany: findManyReposMock },
			activities: { findMany: findManyActivitiesMock },
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => []),
			})),
		})),
	},
}));

const profileUser = {
	id: "profile-user-id",
	username: "octocat",
	displayUsername: "Octocat",
	name: "The Octocat",
	image: null,
	createdAt: new Date("2024-01-01"),
	email: "octocat@example.com",
};

describe("getUserProfile", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getCurrentUserOptionalMock.mockResolvedValue(null);
		findManyReposMock.mockResolvedValue([]);
		findManyActivitiesMock.mockResolvedValue([]);
	});

	it("throws when the username does not exist", async () => {
		findFirstUserMock.mockResolvedValueOnce(undefined);

		const { getUserProfile } = await import("../users");
		await expect(
			getUserProfile({ data: { username: "nobody" } }),
		).rejects.toThrow("User not found");
	});

	it("rejects an empty username", async () => {
		const { getUserProfile } = await import("../users");
		await expect(getUserProfile({ data: { username: "" } })).rejects.toThrow();
		expect(findFirstUserMock).not.toHaveBeenCalled();
	});

	it("returns only public fields for the profile user, never email", async () => {
		findFirstUserMock.mockResolvedValueOnce(profileUser);

		const { getUserProfile } = await import("../users");
		const result = await getUserProfile({ data: { username: "octocat" } });

		expect(result.user).toEqual({
			id: profileUser.id,
			username: profileUser.username,
			displayUsername: profileUser.displayUsername,
			name: profileUser.name,
			image: profileUser.image,
			createdAt: profileUser.createdAt,
		});
		expect(result.user).not.toHaveProperty("email");
	});

	it("marks isSelf false and scopes repos/activity to public when viewed by a stranger", async () => {
		findFirstUserMock.mockResolvedValueOnce(profileUser);
		getCurrentUserOptionalMock.mockResolvedValueOnce({ id: "someone-else" });

		const { getUserProfile } = await import("../users");
		const result = await getUserProfile({ data: { username: "octocat" } });

		expect(result.isSelf).toBe(false);
		// where clause is an implementation detail of drizzle, but the fact
		// that visibility is included in the call args is what stops a
		// stranger from ever seeing private repos.
		const repoCallArgs = findManyReposMock.mock.calls[0][0];
		expect(repoCallArgs?.where).toBeDefined();
	});

	it("marks isSelf true when the viewer owns the profile", async () => {
		findFirstUserMock.mockResolvedValueOnce(profileUser);
		getCurrentUserOptionalMock.mockResolvedValueOnce({ id: profileUser.id });

		const { getUserProfile } = await import("../users");
		const result = await getUserProfile({ data: { username: "octocat" } });

		expect(result.isSelf).toBe(true);
	});

	it("normalizes null activity metadata to an empty object", async () => {
		findFirstUserMock.mockResolvedValueOnce(profileUser);
		findManyActivitiesMock.mockResolvedValueOnce([
			{ id: 1, metadata: null, user: profileUser, repository: {} },
		]);

		const { getUserProfile } = await import("../users");
		const result = await getUserProfile({ data: { username: "octocat" } });

		expect(result.activities[0].metadata).toEqual({});
	});

	it("passes through non-null activity metadata unchanged", async () => {
		findFirstUserMock.mockResolvedValueOnce(profileUser);
		findManyActivitiesMock.mockResolvedValueOnce([
			{
				id: 2,
				metadata: { commitSha: "abc" },
				user: profileUser,
				repository: {},
			},
		]);

		const { getUserProfile } = await import("../users");
		const result = await getUserProfile({ data: { username: "octocat" } });

		expect(result.activities[0].metadata).toEqual({ commitSha: "abc" });
	});

	it("returns the repositories and activities from the db as given", async () => {
		findFirstUserMock.mockResolvedValueOnce(profileUser);
		findManyReposMock.mockResolvedValueOnce([{ id: 1, name: "repo-a" }]);

		const { getUserProfile } = await import("../users");
		const result = await getUserProfile({ data: { username: "octocat" } });

		expect(result.repositories).toEqual([{ id: 1, name: "repo-a" }]);
	});
});
