/**
 * Perf logging switch, plus the isomorphic (SSR + browser) timing helpers
 * used by route loaders and queryFns. Server functions use
 * src/server/perf-log.ts, which prints one indented tree per request.
 *
 * Off in production by default, so visitors' consoles and the server's logs
 * stay quiet:
 * - browser: on in dev, or when localStorage[PERF_LOG_STORAGE_KEY] is "1"
 *   (Settings → Profile → Developer has the toggle);
 * - server: on in dev, or when PUSHSTACK_PERF_LOG=1.
 */

export const PERF_LOG_STORAGE_KEY = "pushstack:perf-log";

const side = typeof window === "undefined" ? "ssr" : "client";

export function isPerfLogEnabled(): boolean {
	if (import.meta.env.DEV) return true;
	if (side === "ssr") return process.env.PUSHSTACK_PERF_LOG === "1";
	try {
		return window.localStorage.getItem(PERF_LOG_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

/** Browser-only: persist the opt-in for this browser. */
export function setPerfLogEnabled(enabled: boolean): void {
	try {
		if (enabled) window.localStorage.setItem(PERF_LOG_STORAGE_KEY, "1");
		else window.localStorage.removeItem(PERF_LOG_STORAGE_KEY);
	} catch {
		// Storage unavailable (private mode, blocked): stays off.
	}
}

function fmt(ms: number): string {
	return `${ms.toFixed(1)}ms`;
}

export async function perfTime<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T> {
	if (!isPerfLogEnabled()) return fn();
	const t0 = performance.now();
	try {
		const result = await fn();
		console.log(`[perf:${side}] ${label} ${fmt(performance.now() - t0)}`);
		return result;
	} catch (err) {
		console.log(
			`[perf:${side}] ${label} FAILED after ${fmt(performance.now() - t0)}`,
		);
		throw err;
	}
}

export function perfMark(label: string): void {
	if (!isPerfLogEnabled()) return;
	console.log(`[perf:${side}] ● ${label} @ ${fmt(performance.now())}`);
}
