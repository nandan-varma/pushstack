import {
	sentryGlobalFunctionMiddleware,
	sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import { createStart } from "@tanstack/react-start";

// Sentry's middlewares must run first in each array to see every downstream
// request/server-function error. SSR render exceptions aren't covered by
// either (see src/routes/__root.tsx's RootErrorComponent for that case).
export const startInstance = createStart(() => ({
	requestMiddleware: [sentryGlobalRequestMiddleware],
	functionMiddleware: [sentryGlobalFunctionMiddleware],
}));
