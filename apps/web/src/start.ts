import {
	type AnyFunctionMiddleware,
	type AnyRequestMiddleware,
	createCsrfMiddleware,
	createStart,
} from "@tanstack/react-start";

const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

interface GlobalMiddleware {
	requestMiddleware: AnyRequestMiddleware[];
	functionMiddleware: AnyFunctionMiddleware[];
}

export const startInstance = createStart(
	async (): Promise<GlobalMiddleware> => {
		if (!import.meta.env.SSR) {
			return { requestMiddleware: [csrfMiddleware], functionMiddleware: [] };
		}
		// The CSP middleware has to run before anything renders: it generates the
		// per-request nonce and hands it to the router through the middleware
		// context (src/server/csp.ts, read back in src/router.tsx).
		const { cspMiddleware } = await import("#/server/csp");
		// Outermost, so the request id covers everything below it.
		const { requestIdMiddleware } = await import("#/server/request-id");
		const { securityHeadersMiddleware } = await import(
			"#/server/security-headers"
		);
		return {
			requestMiddleware: [
				requestIdMiddleware,
				securityHeadersMiddleware,
				cspMiddleware,
				csrfMiddleware,
			],
			functionMiddleware: [],
		};
	},
);
