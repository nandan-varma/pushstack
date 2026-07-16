/**
 * Shared test utilities for server function tests.
 *
 * Usage in a test file:
 *   import { setupServerFnMock } from "@/test/server-test-utils";
 *   setupServerFnMock();
 *
 * This replaces the 7× duplicated `vi.mock("@tanstack/react-start", ...)`
 * block across issues, comments, pull-requests, files, repositories.unit,
 * search, and git-user-lifecycle test files.
 */
import { vi } from "vitest";

/**
 * Mocks `@tanstack/react-start` so that `createServerFn` returns a shim
 * that allows calling `validator(...).handler(...)` chains directly in tests,
 * bypassing the TanStack Start server function transport layer.
 *
 * The async variant (Group A) is chosen because it handles both sync and
 * async handler functions — the only difference from the sync variant is
 * that `await`-ing the result always works, which is the safer default.
 */
export function setupServerFnMock() {
	vi.mock("@tanstack/react-start", () => ({
		createServerFn: () => ({
			validator: (validateFn: (data: unknown) => unknown) => ({
				handler:
					(handlerFn: (args: { data: unknown }) => unknown) =>
					async (args?: { data?: unknown }) =>
						handlerFn({ data: validateFn(args?.data ?? args) }),
			}),
			handler: (handlerFn: (args: unknown) => unknown) => (args: unknown) =>
				handlerFn(args),
		}),
	}));
}
