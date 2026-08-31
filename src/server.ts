import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

const fetch = (request: Request) => handler.fetch(request);

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
