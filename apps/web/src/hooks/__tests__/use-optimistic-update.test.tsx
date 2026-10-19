import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "@/components/toast-provider";
import { useOptimisticUpdate } from "../use-optimistic-update";

interface Item {
	id: number;
	status: "open" | "closed";
}

/**
 * Builds one QueryClient and a wrapper bound to that exact instance, so
 * assertions against the client and the hook's internal useQueryClient() are
 * guaranteed to be looking at the same cache — a separately-constructed
 * client here would silently test nothing.
 */
function setup() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	function wrapper({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>{children}</ToastProvider>
			</QueryClientProvider>
		);
	}

	return { queryClient, wrapper };
}

describe("useOptimisticUpdate", () => {
	it("optimistically applies the updater during onMutate", async () => {
		const { queryClient, wrapper } = setup();
		const queryKey = ["item", 1];
		queryClient.setQueryData(queryKey, { id: 1, status: "open" } as Item);

		const { result } = renderHook(
			() =>
				useOptimisticUpdate<Item>(
					queryKey,
					(old) => (old ? { ...old, status: "closed" } : old),
					"fallback error",
				),
			{ wrapper },
		);

		await act(async () => {
			await result.current.onMutate(undefined);
		});

		expect(queryClient.getQueryData(queryKey)).toEqual({
			id: 1,
			status: "closed",
		});
	});

	it("rolls back to the snapshot and toasts on error", async () => {
		const { queryClient, wrapper } = setup();
		const queryKey = ["item", 2];
		queryClient.setQueryData(queryKey, { id: 2, status: "open" } as Item);

		const { result } = renderHook(
			() => ({
				optimistic: useOptimisticUpdate<Item>(
					queryKey,
					(old) => (old ? { ...old, status: "closed" } : old),
					"fallback error message",
				),
				toastApi: useToast(),
			}),
			{ wrapper },
		);

		let ctx: { prev: Item | undefined } | undefined;
		await act(async () => {
			ctx = await result.current.optimistic.onMutate(undefined);
		});
		expect(queryClient.getQueryData(queryKey)).toEqual({
			id: 2,
			status: "closed",
		});

		act(() => {
			result.current.optimistic.onError(new Error(""), undefined, ctx);
		});

		// Rolled back to the pre-mutation snapshot, not left on the optimistic value.
		expect(queryClient.getQueryData(queryKey)).toEqual({
			id: 2,
			status: "open",
		});
		await waitFor(() => {
			expect(result.current.toastApi.toasts).toHaveLength(1);
		});
		expect(result.current.toastApi.toasts[0]).toMatchObject({
			message: "fallback error message",
			type: "error",
		});
	});

	it("falls back to the error's own message when it has one", async () => {
		const { wrapper } = setup();
		const queryKey = ["item", 3];

		const { result } = renderHook(
			() => ({
				optimistic: useOptimisticUpdate<Item>(
					queryKey,
					(old) => old,
					"generic fallback",
				),
				toastApi: useToast(),
			}),
			{ wrapper },
		);

		act(() => {
			result.current.optimistic.onError(
				new Error("specific failure"),
				undefined,
				undefined,
			);
		});

		await waitFor(() => {
			expect(result.current.toastApi.toasts).toHaveLength(1);
		});
		expect(result.current.toastApi.toasts[0].message).toBe("specific failure");
	});
});
