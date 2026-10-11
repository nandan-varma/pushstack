/**
 * Shared `@tanstack/react-start` mock for server function tests.
 *
 * Usage in a test file (must be a top-level call — vitest hoists `vi.mock`
 * and rejects it inside a function):
 *   vi.mock("@tanstack/react-start", () => import("@/test/server-test-utils"));
 *
 * `createServerFn` returns a shim that allows calling
 * `validator(...).handler(...)` chains directly in tests, bypassing the
 * TanStack Start server function transport layer. The handler is always
 * awaited-safe, so it works for both sync and async handler functions.
 */
export const createServerFn = () => ({
	validator: (validateFn: (data: unknown) => unknown) => ({
		handler:
			(handlerFn: (args: { data: unknown }) => unknown) =>
			async (args?: { data?: unknown }) =>
				handlerFn({ data: validateFn(args?.data ?? args) }),
	}),
	handler: (handlerFn: (args: unknown) => unknown) => (args: unknown) =>
		handlerFn(args),
});
