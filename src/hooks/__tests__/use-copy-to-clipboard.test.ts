import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "../use-copy-to-clipboard";

describe("useCopyToClipboard", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.assign(navigator, {
			clipboard: {
				writeText: vi.fn().mockResolvedValue(undefined),
			},
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts with copied=false", () => {
		const { result } = renderHook(() => useCopyToClipboard());
		expect(result.current.copied).toBe(false);
	});

	it("sets copied=true after copy succeeds", async () => {
		const { result } = renderHook(() => useCopyToClipboard());

		await act(async () => {
			await result.current.copy("hello");
		});

		expect(result.current.copied).toBe(true);
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
	});

	it("resets copied to false after the delay", async () => {
		const { result } = renderHook(() => useCopyToClipboard(1000));

		await act(async () => {
			await result.current.copy("text");
		});

		expect(result.current.copied).toBe(true);

		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(result.current.copied).toBe(false);
	});

	it("uses custom reset delay", async () => {
		const { result } = renderHook(() => useCopyToClipboard(500));

		await act(async () => {
			await result.current.copy("text");
		});

		act(() => {
			vi.advanceTimersByTime(499);
		});
		expect(result.current.copied).toBe(true);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(result.current.copied).toBe(false);
	});

	it("clears previous timeout when copy is called again", async () => {
		const { result } = renderHook(() => useCopyToClipboard(1000));

		await act(async () => {
			await result.current.copy("first");
		});

		act(() => {
			vi.advanceTimersByTime(500);
		});

		await act(async () => {
			await result.current.copy("second");
		});

		expect(result.current.copied).toBe(true);

		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(result.current.copied).toBe(false);
	});

	it("does not crash when clipboard.writeText rejects", async () => {
		vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
			new Error("Not allowed"),
		);
		const { result } = renderHook(() => useCopyToClipboard());

		await act(async () => {
			await result.current.copy("text");
		});

		expect(result.current.copied).toBe(false);
	});
});
