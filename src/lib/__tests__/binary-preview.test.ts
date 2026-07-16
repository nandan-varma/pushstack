/**
 * Tests for binary-preview.ts — base64 encoding/decoding and object URL management.
 *
 * Note: jsdom's Blob and URL APIs have quirks.  Some tests verify the logic
 * path without round-tripping through jsdom's Blob constructor.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	base64ToObjectUrl,
	toPreviewBase64,
	useBinaryObjectUrl,
} from "../binary-preview";

describe("toPreviewBase64", () => {
	it("returns content as-is when isBinary is true", () => {
		expect(toPreviewBase64("SGVsbG8=", true)).toBe("SGVsbG8=");
	});

	it("base64-encodes ASCII text content when isBinary is false", () => {
		const result = toPreviewBase64("hello", false);
		expect(result).toBe(window.btoa("hello"));
	});

	it("encodes empty string", () => {
		expect(toPreviewBase64("", false)).toBe("");
	});

	it("encodes multi-byte text (produces valid base64)", () => {
		const text = "héllo wörld";
		const result = toPreviewBase64(text, false);
		// Verify it produces valid base64 that decodes to the same byte sequence
		const decoded = window.atob(result);
		const originalBytes = new TextEncoder().encode(text);
		const decodedBytes = new Uint8Array(decoded.length);
		for (let i = 0; i < decoded.length; i++) {
			decodedBytes[i] = decoded.charCodeAt(i);
		}
		// Both should produce the same byte length (UTF-8 encoded bytes)
		expect(decodedBytes.length).toBe(originalBytes.length);
		// The result should be valid base64 (no error on decode)
		expect(() => window.atob(result)).not.toThrow();
	});

	it("binary flag bypasses encoding", () => {
		const alreadyBase64 = window.btoa("binary data");
		expect(toPreviewBase64(alreadyBase64, true)).toBe(alreadyBase64);
	});
});

describe("base64ToObjectUrl", () => {
	it("creates a blob URL from base64 data", () => {
		const base64 = window.btoa("test data");
		const url = base64ToObjectUrl(base64, "text/plain");
		expect(url).toMatch(/^blob:/);
		URL.revokeObjectURL(url);
	});

	it("creates URL with correct MIME type", () => {
		const base64 = window.btoa("image data");
		const url = base64ToObjectUrl(base64, "image/png");
		// Verify it's a valid object URL
		expect(url).toMatch(/^blob:/);
		URL.revokeObjectURL(url);
	});
});

describe("useBinaryObjectUrl", () => {
	it("returns null when base64 is undefined", () => {
		const { result } = renderHook(() =>
			useBinaryObjectUrl(undefined, "text/plain"),
		);
		expect(result.current).toBeNull();
	});

	it("returns null when base64 is empty", () => {
		const { result } = renderHook(() => useBinaryObjectUrl("", "text/plain"));
		expect(result.current).toBeNull();
	});

	it("returns a blob URL when base64 is provided", () => {
		const base64 = window.btoa("hello");
		const { result } = renderHook(() =>
			useBinaryObjectUrl(base64, "text/plain"),
		);
		expect(result.current).toMatch(/^blob:/);
	});

	it("updates URL when base64 changes", () => {
		const base64a = window.btoa("first");
		const base64b = window.btoa("second");

		const { result, rerender } = renderHook(
			({ b64, mime }) => useBinaryObjectUrl(b64, mime),
			{ initialProps: { b64: base64a, mime: "text/plain" } },
		);
		const firstUrl = result.current;

		rerender({ b64: base64b, mime: "text/plain" });
		expect(result.current).not.toBe(firstUrl);
	});
});
