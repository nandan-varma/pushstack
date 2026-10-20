import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { connect, MAX_PAGES } from "./client";
import type { Io } from "./io";

let configDir = "";
afterEach(() => rm(configDir, { recursive: true, force: true }));

it("stops following Link after MAX_PAGES pages", async () => {
	configDir = await mkdtemp(join(tmpdir(), "pst-test-"));
	let page = 0;
	const fetchMock = vi.fn<typeof fetch>(async () => {
		page += 1;
		return new Response("[]", {
			headers: {
				link: `<https://git.nandan.fyi/api/v3/repos/a/r/issues?page=${page + 1}>; rel="next"`,
			},
		});
	});
	const io: Io = {
		configDir,
		env: { PST_TOKEN: "t" },
		stdout: vi.fn(),
		stderr: vi.fn(),
		readStdin: async () => "",
		remotes: async () => [],
		isTTY: false,
		fetch: fetchMock,
	};
	const client = await connect(io, "git.nandan.fyi");
	const pages = async () => {
		for await (const _ of client.pages("issues/list-for-repo", {
			owner: "a",
			repo: "r",
		}));
	};
	await expect(pages()).rejects.toThrow(`more than ${MAX_PAGES} pages`);
	expect(fetchMock).toHaveBeenCalledTimes(MAX_PAGES);
});
