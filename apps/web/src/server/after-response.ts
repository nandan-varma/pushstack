/**
 * Work that runs after the response has been sent. On Vercel the platform's
 * `waitUntil` keeps the instance alive for it; in dev and tests there is no
 * request context to hold, so the caller awaits it inline.
 */
import { waitUntil } from "@vercel/functions";

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

/**
 * `@vercel/functions` registers `waitUntil` only when the runtime installed a
 * request context, and exposes no public way to ask. The symbol is its own
 * documented context key.
 */
function hasRequestContext(): boolean {
	const context = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] as
		| { get?: () => unknown }
		| undefined;
	return typeof context?.get === "function";
}

export async function afterResponse(
	task: () => Promise<unknown>,
): Promise<void> {
	const running = task();
	if (hasRequestContext()) {
		waitUntil(running);
		return;
	}
	await running;
}
