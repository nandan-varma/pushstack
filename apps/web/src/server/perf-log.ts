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
import { isPerfLogEnabled } from "#/lib/perf-log";
import { SLOW_REQUEST_MS } from "./config";

interface PerfEntry {
	depth: number;
	text: string;
	/** Undefined for notes and for steps still running when the request ends. */
	ms?: number;
	failed?: boolean;
	note?: boolean;
}

interface PerfRequest {
	/** Unique per request: the correlation id in logs, Sentry and response headers. */
	id: string;
	label: string;
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
/** One JSON object per line in production, so a log drain can index the fields. */
const structured = process.env.NODE_ENV === "production" && !enabled;
/** Bound on recorded entries per request (a pathological loop must not grow forever). */
const MAX_ENTRIES = 500;
/** Finished request trees kept for the dev debug page. */
const RECENT_LIMIT = 50;
const recent: string[] = [];

function fmt(ms: number): string {
	return `${ms.toFixed(1)}ms`;
}

function prefix(request: PerfRequest | undefined): string {
	return request ? `[perf ${request.label}#${request.id}]` : "[perf]";
}

/** The id of the request being served, if any (for response headers and tags). */
export function currentRequestId(): string | undefined {
	return als.getStore()?.request.id;
}

/** Trees of the most recent requests, newest first (dev debug page). */
export function recentPerfTrees(): string[] {
	return [...recent].reverse();
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

function flush(request: PerfRequest, outcome: string, error?: unknown): void {
	const elapsed = performance.now() - request.start;
	const failed = error !== undefined;
	if (enabled) {
		const header = `${prefix(request)} ${outcome} ${fmt(elapsed)} · r2 ${request.r2Calls} calls ${fmt(request.r2TimeMs)} · cache ${request.cacheHits} hit ${request.cacheMisses} miss`;
		const tree = [header, ...request.entries.map(formatEntry)].join("\n");
		recent.push(tree);
		if (recent.length > RECENT_LIMIT) recent.shift();
		console.log(tree);
	}
	const slow = elapsed >= SLOW_REQUEST_MS;
	if (!structured && !slow) return;
	const record = {
		level: failed ? "error" : slow ? "warn" : "info",
		msg: slow ? "slow request" : "request",
		requestId: request.id,
		label: request.label,
		ms: Math.round(elapsed),
		failed,
		r2Calls: request.r2Calls,
		r2Ms: Math.round(request.r2TimeMs),
		cacheHits: request.cacheHits,
		cacheMisses: request.cacheMisses,
		// Top-level steps are the git ops and queries the request spent time on.
		steps: request.entries
			.filter((e) => !e.note && e.depth === 1 && e.ms !== undefined)
			.map((e) => ({ step: e.text, ms: Math.round(e.ms ?? 0) })),
	};
	if (structured) console.log(JSON.stringify(record));
	else console.warn(`${prefix(request)} slow request ${fmt(elapsed)}`);
	if (slow) {
		reportWithSentry((client) =>
			client.addBreadcrumb({
				category: "slow-request",
				message: `${request.label} took ${fmt(elapsed)}`,
				level: "warning",
				data: record,
			}),
		);
	}
}

function newRequest(label: string): PerfRequest {
	return {
		id: crypto.randomUUID().replaceAll("-", ""),
		label,
		start: performance.now(),
		entries: [],
		r2Calls: 0,
		r2TimeMs: 0,
		cacheHits: 0,
		cacheMisses: 0,
	};
}

/**
 * Run `fn` as one request: it gets an id, timing, R2 and cache tallies, and
 * one log record when it finishes. Inside an existing request (a server
 * function called while serving an API request) it is just a step of it, so
 * a request has one id throughout.
 */
export async function perfContext<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T> {
	if (als.getStore()) return timed(label, fn);
	const request = newRequest(label);
	return als.run({ request, depth: 1 }, async () => {
		try {
			const result = await fn();
			flush(request, "done");
			return result;
		} catch (err) {
			flush(
				request,
				`failed (${err instanceof Error ? err.message : String(err)}) after`,
				err,
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
	const scope = als.getStore();
	if (!scope && !enabled) return fn();
	const entry: PerfEntry = { depth: scope?.depth ?? 0, text: step };
	if (scope && scope.request.entries.length < MAX_ENTRIES) {
		scope.request.entries.push(entry);
	}
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
	const scope = als.getStore();
	if (scope) {
		if (scope.request.entries.length < MAX_ENTRIES) {
			scope.request.entries.push({
				depth: scope.depth,
				text: note,
				note: true,
			});
		}
	} else if (enabled) {
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
 * Sentry's server SDK, loaded on first use and only when a DSN is configured.
 * Without one there is nothing to report to, so there is no reason for this
 * module to be in the dependency graph of every route that logs. The fetch
 * wrapper (src/server.ts) and the middlewares (src/start.ts) are gated the same
 * way. Memoized, so the import happens at most once per process.
 */
let sentrySdk: Promise<
	typeof import("@sentry/tanstackstart-react") | null
> | null = null;

function sentry() {
	if (!process.env.VITE_SENTRY_DSN) return Promise.resolve(null);
	sentrySdk ??= import("@sentry/tanstackstart-react").catch(
		(error: unknown) => {
			// A failure to load the reporter must not become the error being logged.
			console.error(`[perf] could not load the Sentry SDK: ${String(error)}`);
			return null;
		},
	);
	return sentrySdk;
}

/**
 * Report through Sentry when one is configured. Deliberately fire-and-forget:
 * every caller is already on an error path, and awaiting a network reporter
 * there would put reporting on the critical path — while a reporter that threw
 * would turn one failure into two.
 */
function reportWithSentry(
	use: (client: typeof import("@sentry/tanstackstart-react")) => void,
): void {
	void sentry().then((client) => {
		if (!client) return;
		try {
			use(client);
		} catch (reportingError) {
			console.error(
				`[perf] Sentry rejected the report: ${String(reportingError)}`,
			);
		}
	});
}

/**
 * Logs an error through one consistent shape, and routes it to Sentry when a
 * DSN is configured (without one the console line is still written).
 * `scope` is the module or subsystem name (e.g. "git-auth"); inside an active
 * perfContext the line also carries that request's correlation id (the same
 * `[perf <id>]` prefix used above). Call sites use this instead of inventing
 * their own console.error/warn with inconsistent prefixing — including the many
 * auth and protocol call sites that aren't wrapped in a perfContext, which
 * still get a consistent `[scope] message` line rather than no prefix at all.
 */
export function logError(scope: string, message: string, err: unknown): void {
	const detail = err instanceof Error ? err.message : String(err);
	const requestId = currentRequestId();
	if (structured) {
		console.error(
			JSON.stringify({ level: "error", scope, message, detail, requestId }),
		);
	} else {
		console.error(
			`${prefix(als.getStore()?.request)} [${scope}] ${message}: ${detail}`,
		);
	}
	reportWithSentry((client) =>
		client.captureException(err instanceof Error ? err : new Error(detail), {
			extra: { scope, message },
			tags: requestId ? { request_id: requestId } : undefined,
		}),
	);
}

export function logWarn(scope: string, message: string, err?: unknown): void {
	const detail =
		err === undefined ? "" : `: ${err instanceof Error ? err.message : err}`;
	if (structured) {
		console.warn(
			JSON.stringify({
				level: "warn",
				scope,
				message,
				detail: detail.slice(2) || undefined,
				requestId: currentRequestId(),
			}),
		);
	} else {
		console.warn(
			`${prefix(als.getStore()?.request)} [${scope}] ${message}${detail}`,
		);
	}
	// Breadcrumb, not a captured event — warnings are expected/handled
	// conditions (see call sites), not incidents worth alerting on by
	// themselves, but useful context if a related error fires later.
	reportWithSentry((client) =>
		client.addBreadcrumb({
			category: scope,
			message,
			level: "warning",
			data: err === undefined ? undefined : { error: String(err) },
		}),
	);
}
