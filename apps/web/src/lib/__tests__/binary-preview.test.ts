// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTextObjectUrl } from "../binary-preview";

describe("useTextObjectUrl", () => {
	it("returns null without text", () => {
		const { result } = renderHook(() =>
			useTextObjectUrl(undefined, "image/svg+xml"),
		);
		expect(result.current).toBeNull();
	});

	it("returns a blob URL for text, including empty text", () => {
		const { result } = renderHook(() => useTextObjectUrl("", "image/svg+xml"));
		expect(result.current).toMatch(/^blob:/);
	});

	it("makes a new URL when the text changes", () => {
		const { result, rerender } = renderHook(
			({ text }) => useTextObjectUrl(text, "image/svg+xml"),
			{ initialProps: { text: "<svg/>" } },
		);
		const first = result.current;
		rerender({ text: "<svg></svg>" });
		expect(result.current).toMatch(/^blob:/);
		expect(result.current).not.toBe(first);
	});
});
