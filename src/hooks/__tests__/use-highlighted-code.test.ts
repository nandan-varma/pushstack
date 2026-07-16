import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHighlightedCode } from "../use-highlighted-code";

const mockRequestHighlight = vi.hoisted(() => vi.fn());

vi.mock("@/lib/syntax-highlight-client", () => ({
	requestHighlight: mockRequestHighlight,
}));

describe("useHighlightedCode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null html and isPending=false when disabled", () => {
		const { result } = renderHook(() =>
			useHighlightedCode("const x = 1;", "typescript", false),
		);
		expect(result.current.html).toBeNull();
		expect(result.current.isPending).toBe(false);
		expect(mockRequestHighlight).not.toHaveBeenCalled();
	});

	it("returns null html and isPending=false when code is empty", () => {
		const { result } = renderHook(() =>
			useHighlightedCode("", "typescript", true),
		);
		expect(result.current.html).toBeNull();
		expect(result.current.isPending).toBe(false);
	});

	it("calls requestHighlight and sets html on success", async () => {
		mockRequestHighlight.mockResolvedValue("<span>highlighted</span>");

		const { result } = renderHook(() =>
			useHighlightedCode("const x = 1;", "typescript", true),
		);

		expect(result.current.isPending).toBe(true);

		await waitFor(() => {
			expect(result.current.isPending).toBe(false);
		});

		expect(result.current.html).toBe("<span>highlighted</span>");
		expect(mockRequestHighlight).toHaveBeenCalledWith(
			"const x = 1;",
			"typescript",
		);
	});

	it("sets html to null on error", async () => {
		mockRequestHighlight.mockRejectedValue(new Error("highlight failed"));

		const { result } = renderHook(() => useHighlightedCode("code", "js", true));

		await waitFor(() => {
			expect(result.current.isPending).toBe(false);
		});

		expect(result.current.html).toBeNull();
	});

	it("clears html when enabled changes to false", async () => {
		mockRequestHighlight.mockResolvedValue("<span>ok</span>");

		const { result, rerender } = renderHook(
			({ enabled }) => useHighlightedCode("code", "js", enabled),
			{ initialProps: { enabled: true } },
		);

		await waitFor(() => {
			expect(result.current.isPending).toBe(false);
		});

		expect(result.current.html).toBe("<span>ok</span>");

		rerender({ enabled: false });

		expect(result.current.html).toBeNull();
		expect(result.current.isPending).toBe(false);
	});

	it("does not set state after unmount", async () => {
		let resolveHighlight: (v: string) => void;
		mockRequestHighlight.mockImplementation(
			() =>
				new Promise((r) => {
					resolveHighlight = r;
				}),
		);

		const { result, unmount } = renderHook(() =>
			useHighlightedCode("code", "js", true),
		);

		expect(result.current.isPending).toBe(true);

		unmount();

		act(() => {
			resolveHighlight!("<span>done</span>");
		});

		expect(result.current.html).toBeNull();
	});
});
