/**
 * @vitest-environment node
 *
 * Release assets across a repository's lifecycle: a transfer moves their
 * storage with the git data, deleting the repository removes it, and an
 * archived repository refuses every release and asset write (including the
 * presigned upload routes) while still serving reads.
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
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { serveReleaseDownload } = await import("../release-assets");
const { releaseAssetStorage } = await import("../git-fs");
const { getReleaseAssetKey } = await import("../git-storage-naming");

const users = await createUsers("alice", "bob");
const del = (token: string) => ({ ...asToken(token), method: "DELETE" });
let alice: string;

const upload = (releaseId: number, repo: string, name: string) =>
	call(`/repos/alice/${repo}/releases/${releaseId}/assets?name=${name}`, {
		...asToken(alice),
		method: "POST",
		body: new TextEncoder().encode("payload"),
		headers: { "content-type": "text/plain" },
	});

async function seed(repo: string) {
	await call("/user/repos", post(alice, { name: repo, auto_init: true }));
	const release = await call(
		`/repos/alice/${repo}/releases`,
		post(alice, { tag_name: "v1" }),
	);
	const asset = await upload(release.body.id, repo, "a.txt");
	return {
		releaseId: release.body.id as number,
		assetId: asset.body.id as number,
	};
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
});

describe("transfer", () => {
	it("moves release assets with the repository", async () => {
		const { assetId } = await seed("mover");
		const oldKey = getReleaseAssetKey("alice", "mover", assetId);
		expect(await releaseAssetStorage.head(oldKey)).not.toBeNull();
		const moved = await call(
			"/repos/alice/mover/transfer",
			post(alice, { new_owner: "bob", new_name: "moved" }),
		);
		expect(moved.status).toBe(202);
		expect(await releaseAssetStorage.head(oldKey)).toBeNull();
		const newKey = getReleaseAssetKey("bob", "moved", assetId);
		expect((await releaseAssetStorage.head(newKey))?.size).toBe(7);
		const response = await serveReleaseDownload(
			new Request("http://localhost:3000/bob/moved/releases/download/v1/a.txt"),
			"bob",
			"moved",
			"v1",
			"a.txt",
		);
		expect(await response.text()).toBe("payload");
		const listed = await call("/repos/bob/moved/releases");
		expect(listed.body[0].assets[0].browser_download_url).toContain(
			"/bob/moved/releases/download/v1/a.txt",
		);
	});
});

describe("delete", () => {
	it("removes the assets' storage with the repository", async () => {
		const { assetId } = await seed("doomed");
		const key = getReleaseAssetKey("alice", "doomed", assetId);
		expect(await releaseAssetStorage.head(key)).not.toBeNull();
		expect((await call("/repos/alice/doomed", del(alice))).status).toBe(204);
		expect(await releaseAssetStorage.head(key)).toBeNull();
	});
});

describe("archived repositories", () => {
	it("refuse release and asset writes but keep serving reads", async () => {
		const { releaseId, assetId } = await seed("frozen");
		// A presigned upload started before the archive.
		const presign = vi
			.spyOn(releaseAssetStorage, "presignPut")
			.mockResolvedValue("https://r2.example/u");
		const pending = await call(
			`/repos/alice/frozen/releases/${releaseId}/assets/uploads`,
			post(alice, { name: "big.bin", size: 3 }),
		);
		expect(pending.status).toBe(201);
		await releaseAssetStorage.put(
			(await import("../git-storage-naming")).getReleaseAssetUploadKey(
				"alice",
				"frozen",
				pending.body.id,
			),
			new Uint8Array(3),
		);
		expect(
			(await call("/repos/alice/frozen", patch(alice, { archived: true })))
				.status,
		).toBe(200);

		const base = "/repos/alice/frozen/releases";
		const refused = [
			await call(base, post(alice, { tag_name: "v2" })),
			await call(`${base}/${releaseId}`, patch(alice, { name: "x" })),
			await call(`${base}/${releaseId}`, del(alice)),
			await call(`${base}/generate-notes`, post(alice, { tag_name: "v1" })),
			await upload(releaseId, "frozen", "b.txt"),
			await call(
				`${base}/${releaseId}/assets/uploads`,
				post(alice, { name: "c.bin", size: 4 }),
			),
			await call(`${base}/assets/${pending.body.id}/finish`, post(alice, {})),
			await call(`${base}/assets/${assetId}`, patch(alice, { name: "z" })),
			await call(`${base}/assets/${assetId}`, del(alice)),
		];
		presign.mockRestore();
		expect(refused.map((r) => r.status)).toEqual(refused.map(() => 403));
		expect(refused[0]?.body.message).toBe(
			"Repository was archived so is read-only.",
		);

		// Reads and downloads still work, and nothing changed.
		const release = await call(`${base}/${releaseId}`);
		expect(release.body.assets.map((a: { name: string }) => a.name)).toEqual([
			"a.txt",
		]);
		const download = await serveReleaseDownload(
			new Request(
				"http://localhost:3000/alice/frozen/releases/download/v1/a.txt",
			),
			"alice",
			"frozen",
			"v1",
			"a.txt",
		);
		expect(await download.text()).toBe("payload");

		// Unarchiving restores writes, and the pending upload can finish.
		await call("/repos/alice/frozen", patch(alice, { archived: false }));
		const finished = await call(
			`${base}/assets/${pending.body.id}/finish`,
			post(alice, {}),
		);
		expect(finished.status).toBe(200);
	});
});
