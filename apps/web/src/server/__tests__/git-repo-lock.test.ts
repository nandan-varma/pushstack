import { describe, expect, it } from "vitest";
import { withRepositoryLock, withRepositoryLocks } from "../git-repo-lock";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("withRepositoryLock", () => {
	it("returns the function's result", async () => {
		await expect(withRepositoryLock("o", "r", async () => 42)).resolves.toBe(
			42,
		);
	});

	it("serializes concurrent writers to the same repository", async () => {
		const events: string[] = [];
		const writer = (name: string) =>
			withRepositoryLock("o", "serial", async () => {
				events.push(`${name}:start`);
				await tick();
				events.push(`${name}:end`);
			});
		await Promise.all([writer("a"), writer("b"), writer("c")]);
		expect(events).toEqual([
			"a:start",
			"a:end",
			"b:start",
			"b:end",
			"c:start",
			"c:end",
		]);
	});

	it("lets different repositories proceed together", async () => {
		let inside = 0;
		let peak = 0;
		const writer = (repo: string) =>
			withRepositoryLock("o", repo, async () => {
				inside += 1;
				peak = Math.max(peak, inside);
				await tick();
				inside -= 1;
			});
		await Promise.all([writer("x"), writer("y")]);
		expect(peak).toBe(2);
	});

	it("releases the lock when the function throws", async () => {
		await expect(
			withRepositoryLock("o", "throws", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await expect(
			withRepositoryLock("o", "throws", async () => "after"),
		).resolves.toBe("after");
	});
});

describe("withRepositoryLocks", () => {
	it("takes several repositories in one order, so opposite orders cannot deadlock", async () => {
		const pair = [
			{ ownerKey: "o", repoName: "left" },
			{ ownerKey: "o", repoName: "right" },
		];
		const results = await Promise.all([
			withRepositoryLocks(pair, async () => "forward"),
			withRepositoryLocks([...pair].reverse(), async () => "backward"),
		]);
		expect(results).toEqual(["forward", "backward"]);
	});

	it("locks a repository named twice only once", async () => {
		const same = { ownerKey: "o", repoName: "self" };
		await expect(
			withRepositoryLocks([same, same], async () => "once"),
		).resolves.toBe("once");
	});
});
