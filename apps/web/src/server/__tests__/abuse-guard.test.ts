import { describe, expect, it } from "vitest";
import { isCrawler, isRepoView, rejectAbusiveRequest } from "../abuse-guard";

const request = (path: string, headers: Record<string, string> = {}) =>
	new Request(`https://git.example${path}`, { headers });

describe("isCrawler", () => {
	it.each([
		"Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)",
		"Mozilla/5.0 (compatible; Amazonbot/0.1)",
		"ClaudeBot/1.0",
		"Bytespider",
		"ChatGPT-User/1.0",
		"HeadlessChrome/130",
	])("recognizes %s", (userAgent) => {
		expect(isCrawler(userAgent)).toBe(true);
	});

	it.each([
		"git/2.45.0",
		"GitHub CLI 2.50.0",
		"python-requests/2.31",
		"Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36",
		null,
	])("lets %s through", (userAgent) => {
		expect(isCrawler(userAgent)).toBe(false);
	});
});

describe("isRepoView", () => {
	it("matches the expensive repo pages only", () => {
		expect(isRepoView("/o/r/blame/main/a.ts")).toBe(true);
		expect(isRepoView("/o/r/raw/main/a.ts")).toBe(true);
		expect(isRepoView("/o/r/archive/refs/heads/main.zip")).toBe(true);
		expect(isRepoView("/o/r")).toBe(false);
		expect(isRepoView("/o/r/issues/1")).toBe(false);
		expect(isRepoView("/o/r.git/info/refs")).toBe(false);
		expect(isRepoView("/api/v3/repos/o/r")).toBe(false);
	});
});

describe("rejectAbusiveRequest", () => {
	it("turns crawlers away with 403, except for robots.txt", async () => {
		const bot = { "user-agent": "GPTBot/1.4" };
		expect(
			(await rejectAbusiveRequest(request("/o/r/blame/x", bot)))?.status,
		).toBe(403);
		expect(await rejectAbusiveRequest(request("/robots.txt", bot))).toBeNull();
	});

	it("lets ordinary clients through", async () => {
		const browser = { "user-agent": "Mozilla/5.0 Chrome/130" };
		expect(
			await rejectAbusiveRequest(request("/o/r/tree/main", browser)),
		).toBeNull();
		expect(await rejectAbusiveRequest(request("/", {}))).toBeNull();
	});
});
