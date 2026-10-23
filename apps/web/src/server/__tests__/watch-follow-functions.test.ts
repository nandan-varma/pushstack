/**
 * @vitest-environment node
 *
 * The web server functions behind the Watch menu and the Follow button:
 * watch levels, counts on the repository and profile reads, following, and
 * that a private repository can't be watched by someone who can't read it.
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

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob", "carol");
const { createRepository, getRepositoryByName } = await import(
	"../repositories"
);
const { setWatchLevel } = await import("../watching");
const { setFollowing, listProfileConnections } = await import("../follows");
const { getUserProfile } = await import("../users");

const repo = async (as?: (typeof users)["alice"]) => {
	if (as) signIn(as);
	else signOut();
	return getRepositoryByName({ data: { owner: "alice", name: "proj" } });
};

beforeAll(async () => {
	signIn(users.alice);
	await createRepository({ data: { name: "proj", visibility: "public" } });
	await createRepository({ data: { name: "secret", visibility: "private" } });
});

describe("watching", () => {
	it("starts watching the repositories you create", async () => {
		const mine = await repo(users.alice);
		expect(mine).toMatchObject({ watchLevel: "all", watcherCount: 1 });
		const bob = await repo(users.bob);
		expect(bob).toMatchObject({ watchLevel: "participating", watcherCount: 1 });
		expect(await repo()).toMatchObject({ watchLevel: "participating" });
	});

	it("moves between the three levels and updates the count", async () => {
		const { id } = await repo(users.bob);
		signIn(users.bob);
		await setWatchLevel({ data: { repoId: id, level: "all" } });
		expect(await repo(users.bob)).toMatchObject({
			watchLevel: "all",
			watcherCount: 2,
		});
		await setWatchLevel({ data: { repoId: id, level: "ignore" } });
		expect(await repo(users.bob)).toMatchObject({
			watchLevel: "ignore",
			watcherCount: 1,
		});
		await setWatchLevel({ data: { repoId: id, level: "participating" } });
		expect(await repo(users.bob)).toMatchObject({
			watchLevel: "participating",
			watcherCount: 1,
		});
	});

	it("needs a session and read access", async () => {
		const { id } = await repo(users.alice);
		signOut();
		await expect(
			setWatchLevel({ data: { repoId: id, level: "all" } }),
		).rejects.toThrow();
		signIn(users.alice);
		const secret = await getRepositoryByName({
			data: { owner: "alice", name: "secret" },
		});
		signIn(users.carol);
		await expect(
			setWatchLevel({ data: { repoId: secret.id, level: "all" } }),
		).rejects.toThrow();
	});
});

describe("following", () => {
	it("follows, counts and lists", async () => {
		signIn(users.bob);
		await setFollowing({ data: { username: "alice", follow: true } });
		signIn(users.carol);
		await setFollowing({ data: { username: "alice", follow: true } });

		const asBob = await (async () => {
			signIn(users.bob);
			return getUserProfile({ data: { username: "alice" } });
		})();
		expect(asBob).toMatchObject({
			followers: 2,
			following: 0,
			isFollowing: true,
			isSelf: false,
		});
		signIn(users.alice);
		expect(await getUserProfile({ data: { username: "alice" } })).toMatchObject(
			{ isFollowing: false, isSelf: true, followers: 2 },
		);
		const list = await listProfileConnections({
			data: { username: "alice", kind: "followers" },
		});
		expect(list.users.map((u) => u.username)).toEqual(["carol", "bob"]);
		expect(list.users[0]).not.toHaveProperty("email");
		expect(
			(
				await listProfileConnections({
					data: { username: "bob", kind: "following" },
				})
			).users.map((u) => u.username),
		).toEqual(["alice"]);
	});

	it("unfollows, and refuses yourself", async () => {
		signIn(users.carol);
		await setFollowing({ data: { username: "alice", follow: false } });
		signIn(users.alice);
		expect(
			(await getUserProfile({ data: { username: "alice" } })).followers,
		).toBe(1);
		await expect(
			setFollowing({ data: { username: "alice", follow: true } }),
		).rejects.toThrow("cannot follow yourself");
	});
});
