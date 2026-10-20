import {
	type InputArgs,
	type ListOperationId,
	type OperationId,
	type Output,
	requestFor,
} from "@pushstack/api-contract/client";
import { baseUrl, type Credentials, credentialsFor } from "./config";
import { CliError, EXIT_AUTH, type Io } from "./io";

export interface RequestOptions {
	method?: string;
	body?: unknown;
	query?: Record<string, string | number | undefined>;
	headers?: Record<string, string>;
}

/** Pages one listing may follow: 10,000 items at 100 per page, plus slack. */
export const MAX_PAGES = 200;

export class HttpError extends CliError {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(`${message} (HTTP ${status})`);
	}
}

/**
 * A client for one host; sends the stored token (or `PST_TOKEN`) when there
 * is one. `requireAuth` fails up front with gh's auth exit code.
 */
export async function connect(
	io: Io,
	host: string,
	requireAuth = false,
	tokenOverride?: string,
) {
	const credentials: Credentials | null = tokenOverride
		? { token: tokenOverride, source: "config" }
		: await credentialsFor(io, host);
	if (!credentials && requireAuth) {
		throw new CliError(
			`not logged in to ${host}. To log in, run: pst auth login --with-token --hostname ${host}`,
			EXIT_AUTH,
		);
	}
	const root = baseUrl(host);

	/** `path` is relative to /api/v3, or an absolute URL (pagination links). */
	function raw(path: string, options: RequestOptions = {}) {
		const url = new URL(
			/^https?:\/\//.test(path) ? path : `${root}/${path.replace(/^\/+/, "")}`,
		);
		if (
			url.origin !== new URL(root).origin ||
			!url.pathname.startsWith("/api/v3/")
		) {
			throw new CliError(
				"request URL must belong to the selected host's /api/v3 API",
			);
		}
		for (const [key, value] of Object.entries(options.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
		const headers: Record<string, string> = {
			accept: "application/vnd.github+json",
			"user-agent": "pushstack-cli",
			...options.headers,
		};
		if (credentials) headers.authorization = `token ${credentials.token}`;
		let body: string | undefined;
		if (options.body !== undefined) {
			body =
				typeof options.body === "string"
					? options.body
					: JSON.stringify(options.body);
			if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type"))
				headers["content-type"] = "application/json";
		}
		return io.fetch(url, {
			method: options.method ?? "GET",
			headers,
			body,
			redirect: "error",
		});
	}

	async function json<T>(path: string, options: RequestOptions = {}) {
		const response = await raw(path, options);
		const text = await response.text();
		if (!response.ok) {
			let message = response.statusText || "request failed";
			try {
				const parsed = JSON.parse(text) as { message?: string };
				if (parsed.message) message = parsed.message;
			} catch {}
			if (response.status === 401) {
				throw new CliError(`${message} (HTTP 401)`, EXIT_AUTH);
			}
			throw new HttpError(response.status, message);
		}
		return { data: (text ? JSON.parse(text) : null) as T, response };
	}

	/** Operation `id` of the API contract; input and response are typed by it. */
	function call<Id extends OperationId>(id: Id, ...input: InputArgs<Id>) {
		const { method, path, body } = requestFor(id, ...input);
		return json<Output<Id>>(path, { method, body });
	}

	/** Each page of list operation `id`, following the `Link` header. */
	async function* pages<Id extends ListOperationId>(
		id: Id,
		...input: InputArgs<Id>
	): AsyncGenerator<Output<Id>> {
		let next: string | undefined = requestFor(id, ...input).path;
		const visited = new Set<string>();
		while (next) {
			if (visited.has(next))
				throw new CliError("API returned a repeated pagination link");
			if (visited.size >= MAX_PAGES)
				throw new CliError(`API returned more than ${MAX_PAGES} pages`);
			visited.add(next);
			const { data, response } = await json<Output<Id>>(next);
			yield data;
			next = nextLink(response);
		}
	}

	return { host, credentials, raw, call, pages };
}

export type Client = Awaited<ReturnType<typeof connect>>;

export function nextLink(response: Response) {
	const link = response.headers.get("link");
	const match = link?.match(/<([^>]+)>;\s*rel="next"/);
	return match?.[1];
}
