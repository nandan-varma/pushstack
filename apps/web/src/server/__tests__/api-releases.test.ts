/**
 * @vitest-environment node
 *
 * GitHub's releases at `/api/v3` and the web download URL: CRUD with
 * GitHub's permissions and status codes, tags created at `target_commitish`,
 * drafts visible to writers only, "latest", asset upload (direct and
 * presigned), streamed downloads with ranges and counts, and a deleted tag
 * leaving its release behind as a draft.
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

const { createUsers, signOut } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { handleApiRequest } = await import("../api");
const { serveReleaseDownload } = await import("../release-assets");
const { releaseAssetStorage } = await import("../git-fs");
const { getReleaseAssetKey } = await import("../git-storage-naming");

const del = (token: string) => ({ ...asToken(token), method: "DELETE" });
const bytes = (text: string) => new TextEncoder().encode(text);

let alice: string;
let bob: string;
let aliceRead: string;

const upload = (
	token: string,
	releaseId: number,
	name: string,
	body: Uint8Array,
	contentType = "text/plain",
) =>
	call(`/repos/alice/proj/releases/${releaseId}/assets?name=${name}`, {
		...asToken(token),
		method: "POST",
		body,
		headers: { "content-type": contentType },
	});

async function download(path: string, init: RequestInit = {}) {
	return serveReleaseDownload(
		new Request(`http://localhost:3000${path}`, init),
		"alice",
		"proj",
		decodeURIComponent(
			path.split("/download/")[1]?.split("/").slice(0, -1).join("/") ?? "",
		),
		decodeURIComponent(path.split("/").at(-1) ?? ""),
	);
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	aliceRead = await mintToken(users.alice, ["repo:read"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	await call(
		"/user/repos",
		post(alice, { name: "secret", private: true, auto_init: true }),
	);
});

describe("releases", () => {
	let id: number;

	it("creates a release and the tag at target_commitish", async () => {
		const { status, body, headers } = await call(
			"/repos/alice/proj/releases",
			post(alice, {
				tag_name: "v1.0.0",
				name: "First",
				body: "## Notes",
				target_commitish: "main",
			}),
		);
		expect(status).toBe(201);
		id = body.id;
		expect(headers.get("location")).toBe(body.url);
		expect(body).toMatchObject({
			tag_name: "v1.0.0",
			target_commitish: "main",
			name: "First",
			body: "## Notes",
			draft: false,
			prerelease: false,
			author: { login: "alice" },
			assets: [],
			html_url: expect.stringContaining("/alice/proj/releases/tag/v1.0.0"),
			upload_url: expect.stringMatching(
				/\/releases\/\d+\/assets\{\?name,label\}$/,
			),
		});
		expect(body.published_at).not.toBeNull();
		const tags = await call("/repos/alice/proj/tags");
		expect(tags.body.map((tag: { name: string }) => tag.name)).toContain(
			"v1.0.0",
		);
	});

	it("rejects a second published release for the same tag with 422", async () => {
		const { status, body } = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "v1.0.0" }),
		);
		expect(status).toBe(422);
		expect(body.errors).toEqual([
			{ resource: "Release", field: "tag_name", code: "already_exists" },
		]);
	});

	it("422s an unknown target_commitish and a missing tag_name", async () => {
		const unknown = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "v9", target_commitish: "nope" }),
		);
		expect(unknown.status).toBe(422);
		expect(unknown.body.errors[0]).toMatchObject({ field: "target_commitish" });
		const missing = await call("/repos/alice/proj/releases", post(alice, {}));
		expect(missing.status).toBe(422);
	});

	it("needs write access: 401 anonymous, 403 for a reader token and for bob", async () => {
		const anonymous = await call("/repos/alice/proj/releases", {
			method: "POST",
			body: JSON.stringify({ tag_name: "x" }),
		});
		expect(anonymous.status).toBe(401);
		expect(
			(
				await call(
					"/repos/alice/proj/releases",
					post(aliceRead, { tag_name: "x" }),
				)
			).status,
		).toBe(403);
		expect(
			(await call("/repos/alice/proj/releases", post(bob, { tag_name: "x" })))
				.status,
		).toBe(403);
	});

	it("gets by id, tag, and latest; lists newest first", async () => {
		expect((await call(`/repos/alice/proj/releases/${id}`)).body.tag_name).toBe(
			"v1.0.0",
		);
		expect((await call("/repos/alice/proj/releases/tags/v1.0.0")).body.id).toBe(
			id,
		);
		expect((await call("/repos/alice/proj/releases/latest")).body.id).toBe(id);
		const second = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "v1.1.0", prerelease: true }),
		);
		expect(second.status).toBe(201);
		const list = await call("/repos/alice/proj/releases");
		expect(list.body.map((r: { tag_name: string }) => r.tag_name)).toEqual([
			"v1.1.0",
			"v1.0.0",
		]);
		// A prerelease is not "latest".
		expect(
			(await call("/repos/alice/proj/releases/latest")).body.tag_name,
		).toBe("v1.0.0");
		expect((await call("/repos/alice/proj/releases/tags/nope")).status).toBe(
			404,
		);
	});

	it("make_latest: true moves the latest badge", async () => {
		const made = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "v0.9.0", make_latest: "true" }),
		);
		expect((await call("/repos/alice/proj/releases/latest")).body.id).toBe(
			made.body.id,
		);
		await call(
			`/repos/alice/proj/releases/${made.body.id}`,
			patch(alice, { make_latest: "false" }),
		);
		expect(
			(await call("/repos/alice/proj/releases/latest")).body.tag_name,
		).toBe("v1.0.0");
	});

	it("updates fields; publishing a draft stamps published_at and creates the tag", async () => {
		const draft = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "v2.0.0", draft: true, name: "Two" }),
		);
		expect(draft.body.draft).toBe(true);
		expect(draft.body.published_at).toBeNull();
		const tagsBefore = await call("/repos/alice/proj/tags");
		expect(tagsBefore.body.map((t: { name: string }) => t.name)).not.toContain(
			"v2.0.0",
		);
		const published = await call(
			`/repos/alice/proj/releases/${draft.body.id}`,
			patch(alice, { draft: false, name: "Two!" }),
		);
		expect(published.status).toBe(200);
		expect(published.body).toMatchObject({ draft: false, name: "Two!" });
		expect(published.body.published_at).not.toBeNull();
		const tagsAfter = await call("/repos/alice/proj/tags");
		expect(tagsAfter.body.map((t: { name: string }) => t.name)).toContain(
			"v2.0.0",
		);
	});

	it("hides drafts from everyone but writers", async () => {
		const draft = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "v3.0.0-draft", draft: true }),
		);
		const path = `/repos/alice/proj/releases/${draft.body.id}`;
		expect((await call(path)).status).toBe(404);
		expect((await call(path, asToken(bob))).status).toBe(404);
		expect((await call(path, asToken(alice))).status).toBe(200);
		const anonymous = await call("/repos/alice/proj/releases");
		expect(anonymous.body.some((r: { draft: boolean }) => r.draft)).toBe(false);
		const mine = await call("/repos/alice/proj/releases", asToken(alice));
		expect(mine.body.some((r: { draft: boolean }) => r.draft)).toBe(true);
		expect(
			(await call("/repos/alice/proj/releases/tags/v3.0.0-draft")).status,
		).toBe(404);
		expect((await call(path, del(alice))).status).toBe(204);
		expect((await call(path, asToken(alice))).status).toBe(404);
	});

	it("hides the releases of a private repository", async () => {
		await call("/repos/alice/secret/releases", post(alice, { tag_name: "s1" }));
		expect((await call("/repos/alice/secret/releases")).status).toBe(404);
		expect(
			(await call("/repos/alice/secret/releases", asToken(bob))).status,
		).toBe(404);
		expect(
			(await call("/repos/alice/secret/releases", asToken(alice))).body,
		).toHaveLength(1);
	});

	it("generates notes from the commits since the previous tag", async () => {
		const { status, body } = await call(
			"/repos/alice/proj/releases/generate-notes",
			post(alice, { tag_name: "v1.1.0" }),
		);
		expect(status).toBe(200);
		expect(body.name).toBe("v1.1.0");
		expect(body.body).toContain("## What's Changed");
		expect(body.body).toContain("Full Changelog");
	});

	it("deleting a tag turns its release into a draft instead of deleting it", async () => {
		const made = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "v4.0.0" }),
		);
		expect(
			(await call("/repos/alice/proj/git/refs/tags/v4.0.0", del(alice))).status,
		).toBe(204);
		expect(
			(await call(`/repos/alice/proj/releases/${made.body.id}`)).status,
		).toBe(404);
		const after = await call(
			`/repos/alice/proj/releases/${made.body.id}`,
			asToken(alice),
		);
		expect(after.body).toMatchObject({ draft: true, published_at: null });
	});

	it("deleting a release keeps the tag", async () => {
		const made = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "v5.0.0" }),
		);
		expect(
			(await call(`/repos/alice/proj/releases/${made.body.id}`, del(alice)))
				.status,
		).toBe(204);
		expect(
			(await call(`/repos/alice/proj/releases/${made.body.id}`)).status,
		).toBe(404);
		const tags = await call("/repos/alice/proj/tags");
		expect(tags.body.map((t: { name: string }) => t.name)).toContain("v5.0.0");
	});
});

describe("release assets", () => {
	let releaseId: number;
	let assetId: number;
	const payload = "hello release asset 0123456789";

	beforeAll(async () => {
		releaseId = (
			await call(
				"/repos/alice/proj/releases",
				post(alice, { tag_name: "assets-1" }),
			)
		).body.id;
	});

	it("uploads raw bytes with name and label", async () => {
		const { status, body } = await call(
			`/repos/alice/proj/releases/${releaseId}/assets?name=notes%20file.txt&label=Notes`,
			{
				...asToken(alice),
				method: "POST",
				body: bytes(payload),
				headers: { "content-type": "text/plain" },
			},
		);
		expect(status).toBe(201);
		assetId = body.id;
		expect(body).toMatchObject({
			name: "notes file.txt",
			label: "Notes",
			state: "uploaded",
			content_type: "text/plain",
			size: payload.length,
			download_count: 0,
			uploader: { login: "alice" },
			browser_download_url: expect.stringContaining(
				"/alice/proj/releases/download/assets-1/notes%20file.txt",
			),
		});
	});

	it("rejects a duplicate name, an empty body, a bad name and non-writers", async () => {
		const duplicate = await upload(
			alice,
			releaseId,
			"notes%20file.txt",
			bytes("x"),
		);
		expect(duplicate.status).toBe(422);
		expect(duplicate.body.errors[0]).toMatchObject({
			field: "name",
			code: "already_exists",
		});
		expect(
			(await upload(alice, releaseId, "empty.bin", new Uint8Array())).status,
		).toBe(422);
		expect((await upload(alice, releaseId, "a%2Fb", bytes("x"))).status).toBe(
			422,
		);
		expect((await upload(bob, releaseId, "b.txt", bytes("x"))).status).toBe(
			403,
		);
		const missingName = await call(
			`/repos/alice/proj/releases/${releaseId}/assets`,
			{
				...asToken(alice),
				method: "POST",
				body: bytes("x"),
			},
		);
		expect(missingName.status).toBe(422);
	});

	it("refuses a body over the direct-upload cap with 413", async () => {
		const { MAX_RELEASE_ASSET_DIRECT_BYTES } = await import("#/lib/limits");
		const big = new Uint8Array(MAX_RELEASE_ASSET_DIRECT_BYTES + 1);
		expect((await upload(alice, releaseId, "big.bin", big)).status).toBe(413);
	});

	it("lists, gets and embeds the assets in the release", async () => {
		const list = await call(`/repos/alice/proj/releases/${releaseId}/assets`);
		expect(list.body.map((a: { id: number }) => a.id)).toEqual([assetId]);
		expect(
			(await call(`/repos/alice/proj/releases/assets/${assetId}`)).body.name,
		).toBe("notes file.txt");
		const release = await call(`/repos/alice/proj/releases/${releaseId}`);
		expect(release.body.assets).toHaveLength(1);
	});

	it("streams the bytes through the web URL and counts downloads", async () => {
		const response = await download(
			"/alice/proj/releases/download/assets-1/notes%20file.txt",
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(payload);
		expect(response.headers.get("content-type")).toBe(
			"application/octet-stream",
		);
		expect(response.headers.get("content-disposition")).toContain("attachment");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-length")).toBe(String(payload.length));
		await vi.waitFor(async () => {
			expect(
				(await call(`/repos/alice/proj/releases/assets/${assetId}`)).body
					.download_count,
			).toBe(1);
		});
	});

	it("serves ranges and HEAD without counting them", async () => {
		const partial = await download(
			"/alice/proj/releases/download/assets-1/notes%20file.txt",
			{ headers: { range: "bytes=6-12" } },
		);
		expect(partial.status).toBe(206);
		expect(await partial.text()).toBe(payload.slice(6, 13));
		expect(partial.headers.get("content-range")).toBe(
			`bytes 6-12/${payload.length}`,
		);
		const head = await download(
			"/alice/proj/releases/download/assets-1/notes%20file.txt",
			{
				method: "HEAD",
			},
		);
		expect(head.status).toBe(200);
		expect(await head.text()).toBe("");
		const bad = await download(
			"/alice/proj/releases/download/assets-1/notes%20file.txt",
			{
				headers: { range: "bytes=500-600" },
			},
		);
		expect(bad.status).toBe(416);
		expect(
			(await call(`/repos/alice/proj/releases/assets/${assetId}`)).body
				.download_count,
		).toBe(1);
	});

	it("streams from the API with Accept: application/octet-stream", async () => {
		const response = await handleApiRequest(
			new Request(
				`http://localhost:3000/api/v3/repos/alice/proj/releases/assets/${assetId}`,
				{
					headers: { accept: "application/octet-stream" },
				},
			),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(payload);
	});

	it("404s unknown assets and the assets of a private repository for strangers", async () => {
		expect(
			(await download("/alice/proj/releases/download/assets-1/missing")).status,
		).toBe(404);
		expect(
			(await download("/alice/proj/releases/download/nope/notes%20file.txt"))
				.status,
		).toBe(404);
		await call("/repos/alice/secret/releases", post(alice, { tag_name: "s2" }));
		const releases = await call("/repos/alice/secret/releases", asToken(alice));
		const secretRelease = releases.body.find(
			(r: { tag_name: string }) => r.tag_name === "s2",
		);
		await call(
			`/repos/alice/secret/releases/${secretRelease.id}/assets?name=a.txt`,
			{
				...asToken(alice),
				method: "POST",
				body: bytes("secret"),
			},
		);
		signOut();
		const response = await serveReleaseDownload(
			new Request(
				"http://localhost:3000/alice/secret/releases/download/s2/a.txt",
			),
			"alice",
			"secret",
			"s2",
			"a.txt",
		);
		expect(response.status).toBe(404);
		const withToken = await serveReleaseDownload(
			new Request(
				"http://localhost:3000/alice/secret/releases/download/s2/a.txt",
				{
					headers: { authorization: `token ${alice}` },
				},
			),
			"alice",
			"secret",
			"s2",
			"a.txt",
		);
		expect(await withToken.text()).toBe("secret");
	});

	it("renames, relabels and deletes an asset (removing its object)", async () => {
		const updated = await call(
			`/repos/alice/proj/releases/assets/${assetId}`,
			patch(alice, { name: "renamed.txt", label: null }),
		);
		expect(updated.body).toMatchObject({ name: "renamed.txt", label: null });
		expect(
			(
				await call(
					`/repos/alice/proj/releases/assets/${assetId}`,
					patch(bob, { name: "x" }),
				)
			).status,
		).toBe(403);
		const key = getReleaseAssetKey("alice", "proj", assetId);
		expect(await releaseAssetStorage.head(key)).not.toBeNull();
		expect(
			(await call(`/repos/alice/proj/releases/assets/${assetId}`, del(alice)))
				.status,
		).toBe(204);
		expect(await releaseAssetStorage.head(key)).toBeNull();
		expect(
			(await call(`/repos/alice/proj/releases/assets/${assetId}`)).status,
		).toBe(404);
	});

	it("deleting a release removes its assets' objects", async () => {
		const made = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "assets-2" }),
		);
		const asset = await upload(alice, made.body.id, "x.bin", bytes("abc"));
		const key = getReleaseAssetKey("alice", "proj", asset.body.id);
		expect(await releaseAssetStorage.head(key)).not.toBeNull();
		await call(`/repos/alice/proj/releases/${made.body.id}`, del(alice));
		expect(await releaseAssetStorage.head(key)).toBeNull();
	});

	it("the assets of a draft are for writers", async () => {
		const draft = await call(
			"/repos/alice/proj/releases",
			post(alice, { tag_name: "assets-draft", draft: true }),
		);
		const asset = await upload(alice, draft.body.id, "d.txt", bytes("draft"));
		const path = `/repos/alice/proj/releases/assets/${asset.body.id}`;
		expect((await call(path)).status).toBe(404);
		expect((await call(path, asToken(alice))).status).toBe(200);
		const url = "/alice/proj/releases/download/assets-draft/d.txt";
		signOut();
		expect((await download(url)).status).toBe(404);
		expect(
			await (
				await download(url, { headers: { authorization: `token ${alice}` } })
			).text(),
		).toBe("draft");
	});
});

describe("presigned asset uploads", () => {
	let releaseId: number;

	beforeAll(async () => {
		releaseId = (
			await call(
				"/repos/alice/proj/releases",
				post(alice, { tag_name: "big-1" }),
			)
		).body.id;
	});

	it("answers 501 where the deployment has no R2", async () => {
		const { status } = await call(
			`/repos/alice/proj/releases/${releaseId}/assets/uploads`,
			post(alice, { name: "big.bin", size: 5_000_000 }),
		);
		expect(status).toBe(501);
		expect(
			(await call(`/repos/alice/proj/releases/${releaseId}/assets`)).body,
		).toEqual([]);
	});

	it("opens the asset, then finishes it once the bytes are in storage", async () => {
		const presign = vi
			.spyOn(releaseAssetStorage, "presignPut")
			.mockResolvedValue("https://r2.example/upload?signature=x");
		const started = await call(
			`/repos/alice/proj/releases/${releaseId}/assets/uploads`,
			post(alice, {
				name: "big.bin",
				size: 5,
				content_type: "application/zip",
			}),
		);
		presign.mockRestore();
		expect(started.status).toBe(201);
		expect(started.body).toMatchObject({
			state: "open",
			upload_url: "https://r2.example/upload?signature=x",
			content_type: "application/zip",
		});
		const id = started.body.id;
		// Not listed (and not downloadable) until finished.
		expect(
			(await call(`/repos/alice/proj/releases/${releaseId}/assets`)).body,
		).toEqual([]);
		const finishPath = `/repos/alice/proj/releases/assets/${id}/finish`;
		// Nothing uploaded yet.
		expect((await call(finishPath, post(alice, {}))).status).toBe(422);
		const key = getReleaseAssetKey("alice", "proj", id);
		await releaseAssetStorage.put(key, bytes("12345"));
		const finished = await call(finishPath, post(alice, {}));
		expect(finished.status).toBe(200);
		expect(finished.body).toMatchObject({ state: "uploaded", size: 5 });
		expect(
			(await call(`/repos/alice/proj/releases/${releaseId}/assets`)).body,
		).toHaveLength(1);
	});

	it("discards an upload whose size differs from the declaration", async () => {
		const presign = vi
			.spyOn(releaseAssetStorage, "presignPut")
			.mockResolvedValue("https://r2.example/upload");
		const started = await call(
			`/repos/alice/proj/releases/${releaseId}/assets/uploads`,
			post(alice, { name: "short.bin", size: 10 }),
		);
		presign.mockRestore();
		const id = started.body.id;
		const key = getReleaseAssetKey("alice", "proj", id);
		await releaseAssetStorage.put(key, bytes("123"));
		const finished = await call(
			`/repos/alice/proj/releases/assets/${id}/finish`,
			post(alice, {}),
		);
		expect(finished.status).toBe(422);
		expect(await releaseAssetStorage.head(key)).toBeNull();
		expect(
			(await call(`/repos/alice/proj/releases/assets/${id}`, asToken(alice)))
				.status,
		).toBe(404);
	});

	it("rejects a declared size over the cap", async () => {
		const { MAX_RELEASE_ASSET_BYTES } = await import("#/lib/limits");
		const { status } = await call(
			`/repos/alice/proj/releases/${releaseId}/assets/uploads`,
			post(alice, { name: "huge.bin", size: MAX_RELEASE_ASSET_BYTES + 1 }),
		);
		expect(status).toBe(422);
	});
});
