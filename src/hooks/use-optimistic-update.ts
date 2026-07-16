import type { QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast-provider";

interface OptimisticContext<TData> {
	prev: TData | undefined;
}

/**
 * The cancelQueries -> snapshot -> optimistic setQueryData -> rollback-on-error
 * shape shared by every "toggle this record's status" mutation in the app (PR
 * merge, PR open/close, issue open/close) — same six lines were duplicated at
 * each call site. Returns onMutate/onError fragments to spread into
 * useMutation's config alongside the mutation-specific mutationFn/onSuccess/
 * onSettled, which still differ per call site.
 *
 * `vars` is deliberately untyped here (matching createServerFn's actual
 * mutationFn signature is awkward to express generically — see its overloaded
 * OptionalFetcher type) — the caller's `updater` narrows it with an inline
 * `as`, same as this logic did before extraction.
 */
export function useOptimisticUpdate<TData>(
	queryKey: QueryKey,
	updater: (old: TData | undefined, vars: unknown) => TData | undefined,
	errorFallbackMessage: string,
) {
	const queryClient = useQueryClient();
	const { toast } = useToast();

	return {
		onMutate: async (vars: unknown) => {
			await queryClient.cancelQueries({ queryKey });
			const prev = queryClient.getQueryData<TData>(queryKey);
			queryClient.setQueryData<TData>(queryKey, (old) => updater(old, vars));
			return { prev } satisfies OptimisticContext<TData>;
		},
		onError: (
			err: Error,
			_vars: unknown,
			ctx: OptimisticContext<TData> | undefined,
		) => {
			if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
			toast(err.message || errorFallbackMessage, "error");
		},
	};
}
