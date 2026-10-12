import {
	type AnyFunctionMiddleware,
	type AnyRequestMiddleware,
	createCsrfMiddleware,
	createStart,
} from "@tanstack/react-start";

const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

// Sentry's middlewares must run first in each array to see every downstream
// request/server-function error. SSR render exceptions aren't covered by
// either (see src/routes/__root.tsx's RootErrorComponent for that case).
// Loaded on the server only: their client halves are no-ops, and a static
// import here puts the whole Sentry SDK in the client's main chunk. The
// browser SDK loads lazily from src/router.tsx instead.
interface GlobalMiddleware {
	requestMiddleware: AnyRequestMiddleware[];
	functionMiddleware: AnyFunctionMiddleware[];
}

export const startInstance = createStart(
	async (): Promise<GlobalMiddleware> => {
		if (!import.meta.env.SSR) {
			return { requestMiddleware: [csrfMiddleware], functionMiddleware: [] };
		}
		const { sentryGlobalFunctionMiddleware, sentryGlobalRequestMiddleware } =
			await import("@sentry/tanstackstart-react");
		return {
			requestMiddleware: [sentryGlobalRequestMiddleware, csrfMiddleware],
			functionMiddleware: [sentryGlobalFunctionMiddleware],
		};
	},
);
