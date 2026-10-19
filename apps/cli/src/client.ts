import { baseUrl, type Credentials, credentialsFor } from "./config";
import { CliError, EXIT_AUTH, type Io } from "./io";

export interface RequestOptions {
	method?: string;
	body?: unknown;
	query?: Record<string, string | number | undefined>;
	headers?: Record<string, string>;
}

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

	return { host, credentials, raw, json };
}

export type Client = Awaited<ReturnType<typeof connect>>;

/** The `rel="next"` URL of a Link header, if any. */
export function nextLink(response: Response) {
	const link = response.headers.get("link");
	const match = link?.match(/<([^>]+)>;\s*rel="next"/);
	return match?.[1];
}
