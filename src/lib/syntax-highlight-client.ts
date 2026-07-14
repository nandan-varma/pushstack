import type { ThemedToken } from "shiki";
import type {
	HighlightMode,
	HighlightRequest,
	HighlightResponse,
} from "@/workers/syntax-highlight.worker";

const MAX_CACHE_ENTRIES = 50;

type Result = string | ThemedToken[][];

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<
	number,
	{ resolve: (result: Result) => void; reject: (error: Error) => void }
>();
const cache = new Map<string, Result>();

function getWorker() {
	if (!worker) {
		worker = new Worker(
			new URL("../workers/syntax-highlight.worker.ts", import.meta.url),
			{ type: "module" },
		);
		worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
			const { id, html, tokens, error } = event.data;
			const request = pending.get(id);
			if (!request) return;
			pending.delete(id);
			const result = html ?? tokens;
			if (error || result === undefined) {
				request.reject(new Error(error || "Highlighting failed"));
			} else {
				request.resolve(result);
			}
		};
	}
	return worker;
}

function cacheKey(code: string, lang: string, mode: HighlightMode) {
	return `${mode} ${lang} ${code}`;
}

function setCached(key: string, result: Result) {
	if (cache.size >= MAX_CACHE_ENTRIES) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey !== undefined) cache.delete(oldestKey);
	}
	cache.set(key, result);
}

function request(
	code: string,
	lang: string,
	mode: HighlightMode,
): Promise<Result> {
	if (typeof window === "undefined" || typeof Worker === "undefined") {
		return Promise.reject(new Error("Syntax highlighting requires a browser"));
	}

	const key = cacheKey(code, lang, mode);
	const cached = cache.get(key);
	if (cached !== undefined) {
		return Promise.resolve(cached);
	}

	const id = nextRequestId++;
	const payload: HighlightRequest = { id, code, lang, mode };

	return new Promise<Result>((resolve, reject) => {
		pending.set(id, {
			resolve: (result) => {
				setCached(key, result);
				resolve(result);
			},
			reject,
		});
		getWorker().postMessage(payload);
	});
}

/** Requests syntax-highlighted HTML for a full code block from the background worker. */
export function requestHighlight(code: string, lang: string): Promise<string> {
	return request(code, lang, "html") as Promise<string>;
}

/** Requests per-line token arrays (for custom rendering, e.g. diff views) from the background worker. */
export function requestHighlightTokens(
	code: string,
	lang: string,
): Promise<ThemedToken[][]> {
	return request(code, lang, "tokens") as Promise<ThemedToken[][]>;
}
