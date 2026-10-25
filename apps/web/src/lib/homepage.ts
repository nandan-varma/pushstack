/**
 * A repository's homepage as a link target: `http(s)` only (it is shown as an
 * anchor to attacker-controlled text), a bare `example.com` gets `https://`.
 */
export function safeHomepageUrl(homepage: string | null): string | null {
	const text = homepage?.trim();
	if (!text) return null;
	try {
		const url = new URL(
			/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`,
		);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

/**
 * Whether a stored homepage is an absolute `http(s)` URL. This is the write-time
 * rule: javascript:, data:, relative and bare host values are refused, so no
 * consumer of the field (REST, GraphQL, the UI) ever receives an unsafe target.
 */
export function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value.trim());
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}
