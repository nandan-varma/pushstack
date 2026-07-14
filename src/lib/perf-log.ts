/**
 * Isomorphic (SSR + browser) timing helper for auditing slow page loads.
 * Prefixes logs with which side they ran on so client-perceived latency
 * (network + server work) can be compared against the server's own
 * perf-log.ts breakdown for the same request.
 */

const side = typeof window === "undefined" ? "ssr" : "client";

function fmt(ms: number): string {
	return `${ms.toFixed(1)}ms`;
}

export async function perfTime<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T> {
	const t0 = performance.now();
	console.log(`[perf:${side}] ▶ ${label}`);
	try {
		const result = await fn();
		console.log(`[perf:${side}] ■ ${label}: ${fmt(performance.now() - t0)}`);
		return result;
	} catch (err) {
		console.log(
			`[perf:${side}] ✗ ${label} FAILED after ${fmt(performance.now() - t0)}`,
		);
		throw err;
	}
}

export function perfMark(label: string): void {
	console.log(`[perf:${side}] ● ${label} @ ${fmt(performance.now())}`);
}
