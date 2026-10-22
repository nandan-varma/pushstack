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

	it("is pending until the highlighter answers, then holds its html", async () => {
		mockRequestHighlight.mockResolvedValue("<span>highlighted</span>");

		const { result } = renderHook(() =>
			useHighlightedCode("const x = 1;", "typescript"),
		);

		expect(result.current).toEqual({ status: "pending" });
		await waitFor(() =>
			expect(result.current).toEqual({
				status: "done",
				html: "<span>highlighted</span>",
			}),
		);
		expect(mockRequestHighlight).toHaveBeenCalledWith(
			"const x = 1;",
			"typescript",
		);
	});

	it("reports a failed highlight so the caller can still show the code", async () => {
		mockRequestHighlight.mockRejectedValue(new Error("highlight failed"));

		const { result } = renderHook(() => useHighlightedCode("code", "js"));

		await waitFor(() => expect(result.current).toEqual({ status: "failed" }));
	});

	it("drops the previous file's html as soon as the code changes", async () => {
		mockRequestHighlight.mockResolvedValueOnce("<span>first</span>");
		mockRequestHighlight.mockImplementationOnce(() => new Promise(() => {}));

		const { result, rerender } = renderHook(
			({ code }) => useHighlightedCode(code, "js"),
			{ initialProps: { code: "first" } },
		);
		await waitFor(() => expect(result.current.status).toBe("done"));

		rerender({ code: "second" });

		expect(result.current).toEqual({ status: "pending" });
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
			useHighlightedCode("code", "js"),
		);

		expect(result.current).toEqual({ status: "pending" });
		unmount();
		act(() => {
			resolveHighlight?.("<span>done</span>");
		});

		expect(result.current).toEqual({ status: "pending" });
	});
});
