/**
 * @vitest-environment node
 *
 * The Content-Security-Policy is a security control only if it is actually
 * enforcing: `script-src 'unsafe-inline'` — what this app shipped before —
 * lets an injected inline script or event handler run, so the policy has to
 * carry a per-request nonce and the nonce has to reach the header. These tests
 * hold the policy to that, and hold the theme script's hash to the constant the
 * document renders, since a drifted hash means a blocked (or unhashed) script.
 */
import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT } from "#/lib/theme";
import { contentSecurityPolicy, generateNonce } from "../csp";

async function sha256Source(source: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(source),
	);
	let binary = "";
	for (const byte of new Uint8Array(digest))
		binary += String.fromCharCode(byte);
	return `'sha256-${btoa(binary)}'`;
}

function directives(policy: string): Map<string, string> {
	return new Map(
		policy.split("; ").map((part) => {
			const [name, ...values] = part.split(" ");
			return [name as string, values.join(" ")];
		}),
	);
}

describe("contentSecurityPolicy", () => {
	it("allows scripts only by nonce, this build's theme script, and same-origin", async () => {
		const nonce = "test-nonce-value";
		const scriptSrc = directives(await contentSecurityPolicy(nonce)).get(
			"script-src",
		);

		expect(scriptSrc).toContain("'self'");
		expect(scriptSrc).toContain(`'nonce-${nonce}'`);
		expect(scriptSrc).toContain(await sha256Source(THEME_INIT_SCRIPT));
		expect(scriptSrc).not.toContain("'unsafe-inline'");
	});

	it("falls back to 'unsafe-inline' only when there is no nonce (development)", async () => {
		const scriptSrc = directives(await contentSecurityPolicy(null)).get(
			"script-src",
		);

		expect(scriptSrc).toContain("'unsafe-inline'");
		expect(scriptSrc).not.toContain("'nonce-");
	});

	it("keeps 'unsafe-inline' for styles, where a nonce would disable it", async () => {
		const styleSrc = directives(
			await contentSecurityPolicy("test-nonce-value"),
		).get("style-src");

		// Shiki's highlighted output styles inline attributes, which a nonce
		// cannot cover; adding one here would make browsers ignore
		// 'unsafe-inline' and blank out every highlighted code block.
		expect(styleSrc).toContain("'unsafe-inline'");
		expect(styleSrc).not.toContain("'nonce-");
	});

	it("blocks framing, plugins, and cross-origin form posts", async () => {
		const policy = directives(await contentSecurityPolicy("n"));

		expect(policy.get("frame-ancestors")).toBe("'none'");
		expect(policy.get("object-src")).toBe("'none'");
		expect(policy.get("base-uri")).toBe("'self'");
		expect(policy.get("form-action")).toBe("'self'");
		expect(policy.get("default-src")).toBe("'self'");
	});

	it("allows the Sentry ingest origin in connect-src when a DSN is configured", async () => {
		const previous = process.env.VITE_SENTRY_DSN;
		process.env.VITE_SENTRY_DSN = "https://abc123.ingest.sentry.io/42";
		try {
			expect(
				directives(await contentSecurityPolicy("n")).get("connect-src"),
			).toContain("https://abc123.ingest.sentry.io");
		} finally {
			if (previous === undefined) delete process.env.VITE_SENTRY_DSN;
			else process.env.VITE_SENTRY_DSN = previous;
		}
	});

	it("survives a malformed DSN without emitting a bogus origin", async () => {
		const previous = process.env.VITE_SENTRY_DSN;
		process.env.VITE_SENTRY_DSN = "not a url";
		try {
			expect(
				directives(await contentSecurityPolicy("n")).get("connect-src"),
			).toBe("'self'");
		} finally {
			if (previous === undefined) delete process.env.VITE_SENTRY_DSN;
			else process.env.VITE_SENTRY_DSN = previous;
		}
	});
});

describe("generateNonce", () => {
	it("produces a distinct, suitably long base64 value each time", () => {
		const nonces = new Set(Array.from({ length: 64 }, () => generateNonce()));
		expect(nonces.size).toBe(64);
		for (const nonce of nonces) {
			expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
			expect(atob(nonce)).toHaveLength(16);
		}
	});
});
