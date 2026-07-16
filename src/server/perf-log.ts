/**
 * Lightweight request-scoped performance logging for auditing slow page loads.
 *
 * Wrap a server function handler in `perfContext(label, fn)` and any awaited
 * sub-step inside it (or inside anything it calls, transitively) in
 * `perfStep(label, fn)` — AsyncLocalStorage threads the request id through
 * without needing to pass a context object through every function signature.
 * Every R2 network call and DB round trip on the tree-page read path is
 * wrapped this way so a single page load prints a full timing breakdown.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface PerfCtx {
	id: string;
	label: string;
	start: number;
	r2Calls: number;
	r2TimeMs: number;
	cacheHits: number;
	cacheMisses: number;
}

const als = new AsyncLocalStorage<PerfCtx>();
let counter = 0;

function fmt(ms: number): string {
	return `${ms.toFixed(1)}ms`;
}

function prefix(ctx: PerfCtx | undefined): string {
	return ctx ? `[perf ${ctx.id}]` : "[perf]";
}

export async function perfContext<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T> {
	const id = `${label}#${(++counter).toString(36)}`;
	const ctx: PerfCtx = {
		id,
		label,
		start: performance.now(),
		r2Calls: 0,
		r2TimeMs: 0,
		cacheHits: 0,
		cacheMisses: 0,
	};
	return als.run(ctx, async () => {
		console.log(`${prefix(ctx)} ▶ start`);
		try {
			const result = await fn();
			const total = performance.now() - ctx.start;
			console.log(
				`${prefix(ctx)} ■ done in ${fmt(total)} (r2: ${ctx.r2Calls} calls / ${fmt(ctx.r2TimeMs)}, cache: ${ctx.cacheHits} hit / ${ctx.cacheMisses} miss)`,
			);
			return result;
		} catch (err) {
			console.log(
				`${prefix(ctx)} ✗ failed after ${fmt(performance.now() - ctx.start)}: ${err instanceof Error ? err.message : String(err)}`,
			);
			throw err;
		}
	});
}

export async function perfStep<T>(
	step: string,
	fn: () => Promise<T>,
): Promise<T> {
	const ctx = als.getStore();
	const t0 = performance.now();
	try {
		const result = await fn();
		console.log(`${prefix(ctx)}   · ${step}: ${fmt(performance.now() - t0)}`);
		return result;
	} catch (err) {
		console.log(
			`${prefix(ctx)}   · ${step}: FAILED after ${fmt(performance.now() - t0)}`,
		);
		throw err;
	}
}

export function perfNote(note: string): void {
	console.log(`${prefix(als.getStore())}   · ${note}`);
}

export function recordR2Call(ms: number): void {
	const ctx = als.getStore();
	if (!ctx) return;
	ctx.r2Calls += 1;
	ctx.r2TimeMs += ms;
}

export function recordCacheHit(): void {
	const ctx = als.getStore();
	if (ctx) ctx.cacheHits += 1;
}

export function recordCacheMiss(): void {
	const ctx = als.getStore();
	if (ctx) ctx.cacheMisses += 1;
}

/**
 * Structured error/warning logging, sharing this module's request-scoped
 * correlation id (the same `[perf <id>]` prefix used above) instead of each
 * call site inventing its own ad-hoc console.error/warn with inconsistent
 * prefixing. `scope` is the module/subsystem name (e.g. "git-auth"); when
 * called from inside an active perfContext, the log line carries that
 * request's id for free — when not (many auth/protocol call sites aren't
 * wrapped in perfContext), it still gets a consistent `[scope] message`
 * shape rather than no prefix at all.
 */
export function logError(scope: string, message: string, err: unknown): void {
	const detail = err instanceof Error ? err.message : String(err);
	console.error(`${prefix(als.getStore())} [${scope}] ${message}: ${detail}`);
}

export function logWarn(scope: string, message: string, err?: unknown): void {
	const detail =
		err === undefined ? "" : `: ${err instanceof Error ? err.message : err}`;
	console.warn(`${prefix(als.getStore())} [${scope}] ${message}${detail}`);
}

/** For R2 helper functions that run both inside and outside a perfContext (e.g. writes). */
export async function perfR2<T>(
	step: string,
	fn: () => Promise<T>,
): Promise<T> {
	const ctx = als.getStore();
	const t0 = performance.now();
	try {
		const result = await fn();
		const ms = performance.now() - t0;
		recordR2Call(ms);
		console.log(`${prefix(ctx)}   · ${step}: ${fmt(ms)}`);
		return result;
	} catch (err) {
		const ms = performance.now() - t0;
		recordR2Call(ms);
		console.log(`${prefix(ctx)}   · ${step}: FAILED after ${fmt(ms)}`);
		throw err;
	}
}
