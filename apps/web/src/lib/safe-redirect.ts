/**
 * A `redirect` search parameter is only followed when it names a path on this
 * site. Anything else (an absolute URL, a protocol-relative `//host`, a
 * backslash trick like `/\host`) is ignored, so a login link cannot send the
 * browser elsewhere.
 */
export function safeInternalPath(value: string | undefined): string | null {
	if (!value || value.length > 2048) return null;
	if (!value.startsWith("/") || value.startsWith("//")) return null;
	if (value.includes("\\")) return null;
	for (const char of value) {
		if (char.charCodeAt(0) < 0x20) return null;
	}
	return value;
}
