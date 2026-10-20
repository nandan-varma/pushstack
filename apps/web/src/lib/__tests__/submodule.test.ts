import { describe, expect, it } from "vitest";
import { submoduleLinks } from "../submodule";

const oid = "a".repeat(40);
const parent = { owner: "alice", name: "app" };
describe("submodule repository links", () => {
	it("resolves sibling and cross-owner clone URLs relative to the parent remote", () => {
		expect(submoduleLinks("../lib.git", oid, parent)).toEqual({
			repository: "/alice/lib",
			commit: `/alice/lib/tree/${oid}`,
		});
		expect(submoduleLinks("../../bob/lib.git", oid, parent)?.repository).toBe(
			"/bob/lib",
		);
	});
	it.each([
		"https://github.com/team/lib.git",
		"git@github.com:team/lib.git",
		"ssh://git@github.com/team/lib.git",
	])("links supported GitHub URL %s to its pinned commit", (url) => {
		expect(submoduleLinks(url, oid, parent)).toEqual({
			repository: "https://github.com/team/lib",
			commit: `https://github.com/team/lib/tree/${oid}`,
		});
	});
	it("handles GitLab groups, Bitbucket, and generic HTTPS remotes", () => {
		expect(
			submoduleLinks("https://gitlab.com/team/group/lib.git", oid, parent)
				?.commit,
		).toBe(`https://gitlab.com/team/group/lib/-/tree/${oid}`);
		expect(
			submoduleLinks("https://bitbucket.org/team/lib.git", oid, parent)?.commit,
		).toBe(`https://bitbucket.org/team/lib/src/${oid}`);
		expect(
			submoduleLinks("https://forge.example/team/lib.git", oid, parent),
		).toEqual({ repository: "https://forge.example/team/lib", commit: null });
	});
	it.each([
		"javascript:alert(1)",
		"data:text/html,test",
		"file:///etc/private",
		"ext::command",
		"//evil.example/lib",
		"https://user:secret@example.com/lib.git",
		"https://example.com/lib.git?token=secret",
		"https://example.com/lib.git#fragment",
		"https://example.com\\@evil.example/lib",
		"https://example.com/\nlib",
		null,
	])("does not turn unsafe or local remotes into links: %s", (url) => {
		expect(submoduleLinks(url, oid, parent)).toBeNull();
	});
	it("does not interpolate an invalid commit into a URL", () => {
		expect(submoduleLinks("../lib.git", "../escape", parent)).toBeNull();
	});
});
