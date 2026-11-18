import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

/**
 * A gist's clone URL (`/{id}.git/…`) is one path segment, which no TanStack
 * route can express (a param cannot share a segment with a literal suffix), so
 * it is matched here, before the router. Repository clones keep their
 * `$owner.$name.*` routes.
 */
const GIST_GIT_PATH = /^\/[0-9a-f]{32}\.git(?:\/|$)/;

function isGistGitRequest(url: string): boolean {
	try {
		return GIST_GIT_PATH.test(new URL(url).pathname);
	} catch {
		return false;
	}
}

const fetch = (request: Request): Promise<Response> => {
	if (isGistGitRequest(request.url)) {
		return import("#/server/git-http").then(({ serveGistGitRequest }) =>
			serveGistGitRequest(request),
		);
	}
	return Promise.resolve(handler.fetch(request));
};

// Do not load Sentry's substantial server SDK on every cold start when error
// reporting is disabled. A dynamic import keeps the no-DSN production path's
// module graph lean while retaining the same wrapper when a DSN is configured.
const serverEntry = process.env.VITE_SENTRY_DSN
	? createServerEntry(
			(await import("@sentry/tanstackstart-react")).wrapFetchWithSentry({
				fetch,
			}),
		)
	: createServerEntry({ fetch });

export default serverEntry;
