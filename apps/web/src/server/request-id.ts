/**
 * Global request middleware: every request runs inside a perf-log request
 * (src/server/perf-log.ts), so one id threads through its perf tree, structured
 * logs, Sentry tags and the `X-Request-Id` response header. Server functions
 * and handlers that call `perfContext` themselves become steps of it.
 * `/api/v3` also sends the same id as `X-GitHub-Request-Id`.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { currentRequestId, perfContext } from "./perf-log";

export const requestIdMiddleware = createMiddleware({ type: "request" }).server(
	({ next }) => {
		const request = getRequest();
		const { pathname } = new URL(request.url);
		return perfContext(`${request.method} ${pathname}`, async () => {
			const id = currentRequestId();
			if (id) setResponseHeader("X-Request-Id", id);
			return next();
		});
	},
);
