/**
 * Refuses crawler traffic and per-client floods before the app renders anything.
 * Every repo view renders in the Worker, so an AI or SEO crawler walking blame
 * pages for every commit costs real CPU; this stops it at the door.
 *
 * Two checks, in order:
 *  - crawlers, by user agent, get 403 everywhere except `/robots.txt` (which
 *    tells compliant ones to leave);
 *  - a client IP browsing repo views faster than the Rate Limiting binding
 *    allows gets 429. Git smart HTTP and the API are not limited here: they have
 *    their own metering (src/server/rate-limit.ts).
 */
import { env } from "./env";

const CRAWLER_USER_AGENT = new RegExp(
	[
		"bot",
		"crawl",
		"spider",
		"scrap",
		"bytespider",
		"omgili",
		"cohere-ai",
		"anthropic-ai",
		"chatgpt-user",
		"perplexity-user",
		"mistralai-user",
		"meta-external",
		"facebookexternalhit",
		"timpi",
		"diffbot",
		"headless",
		"phantomjs",
	].join("|"),
	"i",
);

/** The expensive per-repository pages: `/{owner}/{repo}/{view}/…`. */
const REPO_VIEW =
	/^\/[^/]+\/[^/]+\/(blob|blame|raw|tree|commit|commits|archive|compare)\//;

export function isCrawler(userAgent: string | null): boolean {
	return userAgent !== null && CRAWLER_USER_AGENT.test(userAgent);
}

export function isRepoView(pathname: string): boolean {
	return REPO_VIEW.test(pathname);
}

/** A response that turns the request away, or null to let it through. */
export async function rejectAbusiveRequest(
	request: Request,
): Promise<Response | null> {
	const { pathname } = new URL(request.url);
	if (
		pathname !== "/robots.txt" &&
		isCrawler(request.headers.get("user-agent"))
	) {
		return new Response("Crawlers are not allowed. See /robots.txt.", {
			status: 403,
		});
	}
	if (isRepoView(pathname)) {
		// Cloudflare sets `CF-Connecting-IP` and overwrites any caller's value.
		const key = request.headers.get("cf-connecting-ip") ?? "unknown";
		const { success } = await env.REPO_VIEW_LIMIT.limit({ key });
		if (!success) {
			return new Response("Too many requests", {
				status: 429,
				headers: { "Retry-After": "60" },
			});
		}
	}
	return null;
}
