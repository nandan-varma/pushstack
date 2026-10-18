/**
 * @vitest-environment node
 *
 * `/api/raw` end to end: the size cap, and the checks this route has to do for
 * itself. It is a raw route handler rather than a server function, so it never
 * passes through `files.ts`'s validated schemas — the ref and path validators,
 * and the read-access check, are its own responsibility (see `docs/security.md`).
 *
 * The oversized object is written through the normal commit path with a
 * `Uint8Array`, not base64, so the test doesn't have to build a ~67 MB string to
 * prove a 50 MB cap.
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
const files = await import("../files");
const gitWrite = await import("../git-write");
const repositories = await import("../repositories");
const { serveRawFile } = await import("../raw");
const { MAX_RAW_BYTES } = await import("#/lib/limits");

const users = await createUsers("owner");
const SMALL = "hello raw";
let publicName: string;
let privateName: string;

const raw = (path: string) =>
	serveRawFile(new Request(`http://test.local/api/raw/${path}`));

beforeAll(async () => {
	signIn(users.owner);
	const pub = await repositories.createRepository({
		data: { name: "raw.public", visibility: "public" },
	});
	publicName = pub.name;
	const priv = await repositories.createRepository({
		data: { name: "raw.private", visibility: "private" },
	});
	privateName = priv.name;

	await files.uploadFile({
		data: {
			repoId: pub.id,
			branchName: "main",
			path: "hello.txt",
			content: btoa(SMALL),
			commitMessage: "add hello",
		},
	});
	await gitWrite.createCommit(users.owner.username, pub.name, {
		branch: "main",
		message: "add a file larger than the raw endpoint serves",
		files: [{ path: "big.bin", content: new Uint8Array(MAX_RAW_BYTES + 1) }],
		author: { name: "Owner", email: "owner@example.com" },
	});
});

describe("serveRawFile", () => {
	it("serves a small file's exact bytes as inert text", async () => {
		const response = await raw(
			`${users.owner.username}/${publicName}/main/hello.txt`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"text/plain; charset=utf-8",
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await response.text()).toBe(SMALL);
	});

	it("refuses a file larger than the cap without reading it", async () => {
		const response = await raw(
			`${users.owner.username}/${publicName}/main/big.bin`,
		);
		expect(response.status).toBe(413);
		// The refusal has to say what to do instead, since the file does exist.
		expect(await response.text()).toMatch(/clone/i);
	});

	it("404s a path that isn't in the tree", async () => {
		const response = await raw(
			`${users.owner.username}/${publicName}/main/nope.txt`,
		);
		expect(response.status).toBe(404);
	});

	it("404s a ref that would traverse out of the repository", async () => {
		// Encoded so the URL parser leaves it alone; this route decodes it and
		// must reject it before it reaches the storage layer.
		const response = await raw(
			`${users.owner.username}/${publicName}/%2e%2e%2f%2e%2e%2fetc/passwd`,
		);
		expect(response.status).toBe(404);
	});

	it("404s a private repository for an anonymous reader", async () => {
		signOut();
		const response = await raw(
			`${users.owner.username}/${privateName}/main/x.txt`,
		);
		expect(response.status).toBe(404);
	});
});
