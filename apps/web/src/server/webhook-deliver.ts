/**
 * One outbound webhook delivery: the exact bytes (signed and stored), a
 * DNS-pinned HTTPS POST that cannot be rebound to a private address, the
 * attempt record, and GitHub's single immediate retry when no response
 * arrived at all. A received status is final.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { STATUS_CODES } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import ipaddr from "ipaddr.js";
import {
	MAX_WEBHOOK_DELIVERY_MS,
	MAX_WEBHOOK_PAYLOAD_BYTES,
	MAX_WEBHOOK_RESPONSE_BYTES,
	MAX_WEBHOOK_RETRY_DELAY_MS,
	MAX_WEBHOOK_STORED_PAYLOAD_BYTES,
} from "#/lib/limits";
import { openWebhookSecret } from "./webhook-secret";
import {
	recordWebhookDelivery,
	setWebhookLastResponse,
	type Webhook,
} from "./webhook-store";

export interface WebhookAddress {
	address: string;
	family: number;
}

export type WebhookResolver = (hostname: string) => Promise<WebhookAddress[]>;

export interface WebhookHttpResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
}

export type WebhookAttempt =
	| { response: WebhookHttpResponse }
	| { failure: string; retryable: boolean };

export interface WebhookTransportRequest {
	url: URL;
	address: WebhookAddress;
	headers: Record<string, string>;
	body: string;
	timeoutMs: number;
	maxResponseBytes: number;
}

export type WebhookTransport = (
	request: WebhookTransportRequest,
) => Promise<WebhookAttempt>;

export interface WebhookDelivery {
	hook: Webhook;
	event: string;
	action: string | null;
	payload: unknown;
	/** Exact bytes to send instead of a serialization of `payload` (a redelivery). */
	body?: string;
	redelivery?: boolean;
}

export interface WebhookDeliveryDeps {
	transport?: WebhookTransport;
	resolve?: WebhookResolver;
	sleep?: (ms: number) => Promise<void>;
}

/** The hex `X-Hub-Signature-256` value's digest over the exact body bytes. */
export function webhookSignature(
	secret: string,
	body: string | Buffer,
): string {
	return createHmac("sha256", secret).update(body).digest("hex");
}

function isGlobalUnicast(address: string): boolean {
	const parsed = ipaddr.parse(address);
	if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
		return isGlobalUnicast(parsed.toIPv4Address().toString());
	}
	return parsed.range() === "unicast";
}

function unpinHostname(url: URL): string {
	return url.hostname.replace(/^\[|\]$/g, "");
}

interface WebhookTarget {
	url: URL;
	address: WebhookAddress;
}

async function resolveTarget(
	rawUrl: string,
	resolve: WebhookResolver,
): Promise<WebhookTarget> {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:") {
		throw new Error("Webhook URLs must use https");
	}
	const hostname = unpinHostname(url);
	const literal = isIP(hostname);
	const addresses = literal
		? [{ address: hostname, family: literal }]
		: await resolve(hostname);
	const [first] = addresses;
	if (!first) throw new Error("Webhook URL resolved to no address");
	for (const address of addresses) {
		if (!isGlobalUnicast(address.address)) {
			throw new Error("Webhook URL resolves to a non-public address");
		}
	}
	return { url, address: first };
}

function responseHeaders(
	headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
	const record: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value !== undefined) {
			record[name] = Array.isArray(value) ? value.join(", ") : value;
		}
	}
	return record;
}

/** Read at most `maxBytes` from a response, then drop the socket. */
export async function readResponseBody(
	stream: Readable,
	maxBytes: number,
): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	try {
		for await (const chunk of stream) {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			const remaining = maxBytes - size;
			if (bytes.length < remaining) {
				chunks.push(bytes);
				size += bytes.length;
				continue;
			}
			if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
			stream.destroy();
			break;
		}
	} catch {
		// A socket destroyed at the cap or by the receiver still has a status,
		// so the bytes read so far are the attempt's body.
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** The default transport: HTTPS only, pinned to the resolved address. */
export const postWebhook: WebhookTransport = (request) =>
	new Promise((resolve) => {
		const hostname = unpinHostname(request.url);
		const lookup: LookupFunction = (_host, options, callback) => {
			if (options.all) callback(null, [request.address]);
			else callback(null, request.address.address, request.address.family);
		};
		let done = false;
		let received: {
			statusCode: number;
			headers: Record<string, string>;
		} | null = null;
		const finish = (attempt: WebhookAttempt) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(attempt);
		};
		const timer = setTimeout(() => {
			req.destroy();
			const answered = received;
			finish(
				answered
					? {
							response: {
								statusCode: answered.statusCode,
								headers: answered.headers,
								body: "",
							},
						}
					: { failure: "Webhook delivery timed out", retryable: true },
			);
		}, request.timeoutMs);
		const req = httpsRequest(
			{
				method: "POST",
				host: hostname,
				port: request.url.port || 443,
				path: `${request.url.pathname}${request.url.search}`,
				headers: { ...request.headers, Host: request.url.host },
				agent: false,
				lookup,
				...(isIP(hostname) ? {} : { servername: hostname }),
			},
			(res) => {
				const answered = {
					statusCode: res.statusCode ?? 0,
					headers: responseHeaders(res.headers),
				};
				received = answered;
				void readResponseBody(res, request.maxResponseBytes).then((body) =>
					finish({ response: { ...answered, body } }),
				);
			},
		);
		req.on("error", (error) => {
			if (received) return;
			finish({
				failure: error instanceof Error ? error.message : String(error),
				retryable: true,
			});
		});
		req.end(request.body);
	});

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function lastResponse(attempt: WebhookAttempt): {
	code: number | null;
	status: string;
	message: string | null;
} {
	if ("response" in attempt) {
		return {
			code: attempt.response.statusCode,
			status: STATUS_CODES[attempt.response.statusCode] ?? "Unknown",
			message: null,
		};
	}
	return { code: null, status: "failed", message: attempt.failure };
}

export async function deliverWebhook(
	delivery: WebhookDelivery,
	deps: WebhookDeliveryDeps = {},
): Promise<void> {
	const { hook } = delivery;
	const json = JSON.stringify(delivery.payload);
	const body =
		delivery.body ??
		(hook.contentType === "form"
			? `payload=${encodeURIComponent(json)}`
			: json);
	const bytes = Buffer.from(body, "utf8");
	if (bytes.byteLength > MAX_WEBHOOK_PAYLOAD_BYTES) return;

	const guid = randomUUID();
	const headers: Record<string, string> = {
		"Content-Type":
			hook.contentType === "form"
				? "application/x-www-form-urlencoded"
				: "application/json",
		"X-GitHub-Event": delivery.event,
		"X-GitHub-Delivery": guid,
		"X-GitHub-Hook-ID": String(hook.id),
		"X-GitHub-Hook-Installation-Target-ID": String(hook.repoId),
		"X-GitHub-Hook-Installation-Target-Type": "repository",
		"User-Agent": `GitHub-Hookshot/${randomBytes(4).toString("hex")}`,
	};
	if (hook.secretSealed) {
		headers["X-Hub-Signature-256"] = `sha256=${webhookSignature(
			openWebhookSecret(hook.secretSealed),
			bytes,
		)}`;
	}

	const retryDelay = MAX_WEBHOOK_RETRY_DELAY_MS;
	const wait = deps.sleep ?? sleep;
	const transport = deps.transport ?? postWebhook;
	const started = Date.now();
	let attempt: WebhookAttempt;
	try {
		const target = await resolveTarget(
			hook.url,
			deps.resolve ??
				((hostname) =>
					dnsLookup(hostname, { all: true }) as Promise<WebhookAddress[]>),
		);
		for (let count = 1; ; count += 1) {
			attempt = await transport({
				...target,
				headers,
				body,
				timeoutMs: MAX_WEBHOOK_DELIVERY_MS,
				maxResponseBytes: MAX_WEBHOOK_RESPONSE_BYTES,
			});
			if ("response" in attempt || !attempt.retryable || count === 2) {
				break;
			}
			await wait(retryDelay);
		}
	} catch (error) {
		attempt = {
			failure: error instanceof Error ? error.message : String(error),
			retryable: false,
		};
	}

	const response = "response" in attempt ? attempt.response : null;
	const failure = "response" in attempt ? null : attempt.failure;
	const status =
		response && response.statusCode >= 200 && response.statusCode < 300
			? "success"
			: "failure";
	await recordWebhookDelivery({
		webhookId: hook.id,
		guid,
		event: delivery.event,
		action: delivery.action,
		requestHeaders: headers,
		requestPayload:
			bytes.byteLength <= MAX_WEBHOOK_STORED_PAYLOAD_BYTES ? body : null,
		status,
		statusCode: response?.statusCode ?? null,
		responseHeaders: response?.headers ?? null,
		responsePayload: response?.body ?? failure,
		durationMs: Date.now() - started,
		redelivery: delivery.redelivery ?? false,
	});
	await setWebhookLastResponse(hook.id, lastResponse(attempt));
}
