/**
 * Request-scoped performance logging for auditing slow page loads.
 *
 * Wrap a server function handler in `perfContext(label, fn)` and any awaited
 * sub-step inside it (or inside anything it calls, transitively) in
 * `perfStep(label, fn)` — AsyncLocalStorage threads the request through
 * without passing a context object through every function signature. Steps
 * nest: a step started inside another step is its child. When the request
 * finishes, its whole timing tree prints as one indented block:
 *
 *   [perf getTreePageData repo=11 main:/#4] done 535.4ms · r2 5 calls 1175.7ms · cache 41 hit 5 miss
 *     · getCurrentUserOptional 0.4ms
 *     · getRepositoryTreeData 530.2ms
 *       · R2 LIST repos/…/refs/heads/ 214.8ms
 *       • getCommitLog: result-cache MISS …
 *
 * Disabled (the production default — see isPerfLogEnabled in
 * src/lib/perf-log.ts) every helper here just runs its function. `logError`
 * and `logWarn` always log.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/tanstackstart-react";
import { isPerfLogEnabled } from "#/lib/perf-log";

interface PerfEntry {
	depth: number;
	text: string;
	/** Undefined for notes and for steps still running when the request ends. */
	ms?: number;
	failed?: boolean;
	note?: boolean;
}

interface PerfRequest {
	id: string;
	start: number;
	entries: PerfEntry[];
	r2Calls: number;
	r2TimeMs: number;
	cacheHits: number;
	cacheMisses: number;
}

interface PerfScope {
	request: PerfRequest;
	/** Depth new entries are recorded at. */
	depth: number;
}

const als = new AsyncLocalStorage<PerfScope>();
const enabled = isPerfLogEnabled();
let counter = 0;

function fmt(ms: number): string {
	return `${ms.toFixed(1)}ms`;
}

function prefix(request: PerfRequest | undefined): string {
	return request ? `[perf ${request.id}]` : "[perf]";
}

function formatEntry(entry: PerfEntry): string {
	const indent = "  ".repeat(entry.depth);
	if (entry.note) return `${indent}• ${entry.text}`;
	const time =
		entry.ms === undefined
			? "(unfinished)"
			: entry.failed
				? `FAILED after ${fmt(entry.ms)}`
				: fmt(entry.ms);
	return `${indent}· ${entry.text} ${time}`;
}

function flush(request: PerfRequest, outcome: string): void {
	const total = fmt(performance.now() - request.start);
	const header = `${prefix(request)} ${outcome} ${total} · r2 ${request.r2Calls} calls ${fmt(request.r2TimeMs)} · cache ${request.cacheHits} hit ${request.cacheMisses} miss`;
	console.log([header, ...request.entries.map(formatEntry)].join("\n"));
}

export async function perfContext<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T> {
	if (!enabled) return fn();
	const request: PerfRequest = {
		id: `${label}#${(++counter).toString(36)}`,
		start: performance.now(),
		entries: [],
		r2Calls: 0,
		r2TimeMs: 0,
		cacheHits: 0,
		cacheMisses: 0,
	};
	return als.run({ request, depth: 1 }, async () => {
		try {
			const result = await fn();
			flush(request, "done");
			return result;
		} catch (err) {
			flush(
				request,
				`failed (${err instanceof Error ? err.message : String(err)}) after`,
			);
			throw err;
		}
	});
}

/**
 * Time `fn` as an entry of the current request (outside one, as a single
 * line); work it starts is recorded one level deeper.
 */
async function timed<T>(
	step: string,
	fn: () => Promise<T>,
	onDone?: (ms: number) => void,
): Promise<T> {
	if (!enabled) return fn();
	const scope = als.getStore();
	const entry: PerfEntry = { depth: scope?.depth ?? 0, text: step };
	scope?.request.entries.push(entry);
	const t0 = performance.now();
	const finish = (failed: boolean) => {
		entry.ms = performance.now() - t0;
		entry.failed = failed;
		onDone?.(entry.ms);
		if (!scope) console.log(`[perf] ${formatEntry(entry).trimStart()}`);
	};
	try {
		const result = scope
			? await als.run(
					{ request: scope.request, depth: scope.depth + 1 },
					// Await inside the scope: lazy thenables (Drizzle queries) only
					// start running when awaited.
					async () => await fn(),
				)
			: await fn();
		finish(false);
		return result;
	} catch (err) {
		finish(true);
		throw err;
	}
}

export function perfStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
	return timed(step, fn);
}

/** An R2 call: timed like a step and tallied in the request's R2 totals. */
export function perfR2<T>(step: string, fn: () => Promise<T>): Promise<T> {
	return timed(step, fn, recordR2Call);
}

export function perfNote(note: string): void {
	if (!enabled) return;
	const scope = als.getStore();
	if (scope) {
		scope.request.entries.push({ depth: scope.depth, text: note, note: true });
	} else {
		console.log(`[perf] • ${note}`);
	}
}

export function recordR2Call(ms: number): void {
	const request = als.getStore()?.request;
	if (!request) return;
	request.r2Calls += 1;
	request.r2TimeMs += ms;
}

export function recordCacheHit(): void {
	const request = als.getStore()?.request;
	if (request) request.cacheHits += 1;
}

export function recordCacheMiss(): void {
	const request = als.getStore()?.request;
	if (request) request.cacheMisses += 1;
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
	console.error(
		`${prefix(als.getStore()?.request)} [${scope}] ${message}: ${detail}`,
	);
	Sentry.captureException(err instanceof Error ? err : new Error(detail), {
		extra: { scope, message },
	});
}

export function logWarn(scope: string, message: string, err?: unknown): void {
	const detail =
		err === undefined ? "" : `: ${err instanceof Error ? err.message : err}`;
	console.warn(
		`${prefix(als.getStore()?.request)} [${scope}] ${message}${detail}`,
	);
	// Breadcrumb, not a captured event — warnings are expected/handled
	// conditions (see call sites), not incidents worth alerting on by
	// themselves, but useful context if a related error fires later.
	Sentry.addBreadcrumb({
		category: scope,
		message,
		level: "warning",
		data: err === undefined ? undefined : { error: String(err) },
	});
}
