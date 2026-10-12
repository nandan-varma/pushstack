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
/** Either validator form createServerFn accepts: a function, or a Standard Schema (zod). */
type Validator =
	| ((data: unknown) => unknown)
	| {
			"~standard": {
				validate: (
					data: unknown,
				) =>
					| { value: unknown; issues?: undefined }
					| { issues: readonly { message: string }[] }
					| Promise<unknown>;
			};
	  };

async function validate(validator: Validator, data: unknown): Promise<unknown> {
	if (typeof validator === "function") return validator(data);
	const result = (await validator["~standard"].validate(data)) as
		| { value: unknown; issues?: undefined }
		| { issues: readonly { message: string }[] };
	if (result.issues) {
		throw new Error(result.issues.map((issue) => issue.message).join("; "));
	}
	return result.value;
}

export const createServerFn = () => ({
	validator: (validator: Validator) => ({
		handler:
			(handlerFn: (args: { data: unknown }) => unknown) =>
			async (args?: { data?: unknown }) =>
				handlerFn({ data: await validate(validator, args?.data ?? args) }),
	}),
	handler: (handlerFn: (args: unknown) => unknown) => (args: unknown) =>
		handlerFn(args),
});
