/**
 * @vitest-environment node
 *
 * The R2 round-trip budget for repeated reads.
 *
 * "Keep R2 round trips low; cache aggressively" is a hard constraint — Vercel's
 * function limits, and R2 is the only object store — so it gets a mechanical
 * guard rather than a prose rule. The perf tree's own counts are the evidence:
 * a repeated read that is supposed to be cached must report zero R2 calls, and
 * a cold read must stay inside a ceiling, so a change that reads per call (a
 * cache hook dropped, a key that misses) fails here instead of in production.
 *
 * Counts are per test file: vitest runs each file in its own worker, so the
 * caches start empty and the numbers are deterministic.
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

const { createUsers, signIn } = await import("../../test/app-harness");
const files = await import("../files");
const repositories = await import("../repositories");
const { perfContext, recentPerfTrees } = await import("../perf-log");

const users = await createUsers("owner");
let repoId: number;

const tally = async (fn: () => Promise<unknown>) => {
	await perfContext("budget", fn);
	const header = recentPerfTrees()[0] ?? "";
	const r2 = /r2 (\d+) calls/.exec(header);
	const cache = /cache (\d+) hit (\d+) miss/.exec(header);
	// The guard reads the perf tree, so if perf logging is ever off under test
	// this fails loudly rather than passing vacuously.
	expect(r2, `no r2 tally in: ${header}`).not.toBeNull();
	expect(cache, `no cache tally in: ${header}`).not.toBeNull();
	return {
		r2Calls: Number(r2?.[1]),
		hits: Number(cache?.[1]),
		misses: Number(cache?.[2]),
	};
};

beforeAll(async () => {
	signIn(users.owner);
	const repo = await repositories.createRepository({
		data: { name: "budget" },
	});
	repoId = repo.id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("hello"),
			commitMessage: "add a",
		},
	});
});

describe("R2 round trips", () => {
	it("serves a repeated history read without touching object storage", async () => {
		const read = () =>
			files.getCommits({ data: { repoId, branchName: "main" } });

		await tally(read);
		const second = await tally(read);
		expect(second.r2Calls).toBe(0);
		expect(second.hits).toBeGreaterThan(0);
	});

	it("serves a repeated file read without touching object storage", async () => {
		const read = () =>
			files.getFile({
				data: { repoId, branchName: "main", path: "a.txt" },
			});

		const first = await tally(read);
		// A ceiling against a per-call explosion, not a fingerprint of today's
		// object layout.
		expect(first.r2Calls).toBeLessThanOrEqual(20);

		const second = await tally(read);
		expect(second.r2Calls).toBe(0);
	});
});
