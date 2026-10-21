import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { useEffect } from "react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { queryKeys, threadSubscriptionQueryOptions } from "@/lib/query-options";
import {
	markThreadViewed,
	setThreadSubscription,
} from "@/server/notifications";

/** GitHub's sidebar "Subscribe / Unsubscribe" for an issue or pull request. */
export function ThreadSubscriptionButton({
	repoId,
	number,
}: {
	repoId: number;
	number: number;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const options = threadSubscriptionQueryOptions(repoId, number);
	const { data } = useQuery(options);
	const subscribed = data?.subscribed ?? false;
	// Viewing the thread reads its notification, as on GitHub.
	useEffect(() => {
		markThreadViewed({ data: { repoId, number } }).then((changed) => {
			if (changed) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.notificationsRoot,
				});
			}
		});
	}, [repoId, number, queryClient]);
	const mutation = useMutation({
		mutationFn: (next: boolean) =>
			setThreadSubscription({ data: { repoId, number, subscribed: next } }),
		onSuccess: (state) => queryClient.setQueryData(options.queryKey, state),
		onError: (error) =>
			toast(error.message || "Couldn't update subscription", "error"),
	});

	return (
		<div className="flex items-center gap-3 text-sm text-muted-foreground">
			<Button
				variant="outline"
				size="sm"
				disabled={!data || mutation.isPending}
				onClick={() => mutation.mutate(!subscribed)}
			>
				{subscribed ? (
					<BellOff aria-hidden="true" className="mr-1 h-4 w-4" />
				) : (
					<Bell aria-hidden="true" className="mr-1 h-4 w-4" />
				)}
				{subscribed ? "Unsubscribe" : "Subscribe"}
			</Button>
			<span>
				{subscribed
					? "You're receiving notifications because you're subscribed to this thread."
					: "You're not receiving notifications from this thread."}
			</span>
		</div>
	);
}
