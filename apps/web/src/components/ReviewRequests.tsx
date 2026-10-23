import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Settings2, X } from "lucide-react";
import { useState } from "react";
import { AsideSection } from "@/components/layout/page";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { queryKeys, reviewerCandidatesQueryOptions } from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";
import {
	removePullRequestReviewRequest,
	requestPullRequestReviewers,
} from "@/server/review-requests";

interface Person {
	id: string;
	username: string;
	name: string;
}

/**
 * A pull request's requested reviewers. Anyone sees them; the author and
 * anyone with write access (`canEdit`) can request a review from the
 * repository's owner or a collaborator (never the author) or withdraw one.
 */
export function ReviewRequests({
	pullRequestId,
	repoId,
	authorId,
	reviewers,
	canEdit,
	onChanged,
}: {
	pullRequestId: number;
	repoId: number;
	authorId: string;
	reviewers: Person[];
	canEdit: boolean;
	onChanged: () => void;
}) {
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const [isEditing, setIsEditing] = useState(false);
	const { data: candidates } = useQuery({
		...reviewerCandidatesQueryOptions(repoId),
		enabled: canEdit && isEditing,
	});
	const mutation = useMutation({
		mutationFn: ({ username, add }: { username: string; add: boolean }) =>
			add
				? requestPullRequestReviewers({
						data: { prId: pullRequestId, usernames: [username] },
					})
				: removePullRequestReviewRequest({
						data: { prId: pullRequestId, usernames: [username] },
					}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.timelineRoot(repoId),
			});
			onChanged();
		},
		onError: (err: Error) =>
			toast(err.message || "Failed to update review requests", "error"),
	});
	const selected = new Set(reviewers.map((r) => r.username));

	return (
		<AsideSection
			title="Reviewers"
			action={
				canEdit && (
					<button
						type="button"
						className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
						aria-label={isEditing ? "Done editing reviewers" : "Edit reviewers"}
						aria-expanded={isEditing}
						onClick={() => setIsEditing((v) => !v)}
					>
						{isEditing ? <Check /> : <Settings2 />}
					</button>
				)
			}
		>
			{reviewers.length === 0 ? (
				<p className="text-sm text-bjork-text-soft">No reviews requested</p>
			) : (
				<ul className="space-y-2">
					{reviewers.map((r) => (
						<li key={r.id} className="flex items-center justify-between gap-2">
							<Link
								to="/$owner"
								params={{ owner: r.username }}
								className="flex items-center gap-2 text-sm font-medium text-bjork-text hover:text-bjork-accent"
							>
								<Avatar size="sm">
									<AvatarFallback className="text-[11px]">
										{getInitials(r.name || r.username)}
									</AvatarFallback>
								</Avatar>
								{r.username}
							</Link>
							{canEdit && isEditing && (
								<button
									type="button"
									className={buttonVariants({
										variant: "ghost",
										size: "icon-xs",
									})}
									aria-label={`Remove review request for ${r.username}`}
									disabled={mutation.isPending}
									onClick={() =>
										mutation.mutate({ username: r.username, add: false })
									}
								>
									<X />
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{canEdit && isEditing && (
				<ul className="mt-3 space-y-0.5 rounded-[14px] border border-bjork-border bg-bjork-field-inset p-1.5 shadow-(--bjork-shadow-inset)">
					{(candidates ?? [])
						.filter((u) => u.id !== authorId)
						.map((u) => (
							<li key={u.id}>
								<label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-sm hover:bg-bjork-surface-hover">
									<input
										type="checkbox"
										className="size-4 accent-[var(--bjork-accent)]"
										checked={selected.has(u.username)}
										disabled={mutation.isPending}
										onChange={(e) =>
											mutation.mutate({
												username: u.username,
												add: e.target.checked,
											})
										}
									/>
									<span className="font-medium text-bjork-text">
										{u.username}
									</span>
									<span className="truncate text-bjork-text-soft">
										{u.name}
									</span>
								</label>
							</li>
						))}
				</ul>
			)}
		</AsideSection>
	);
}
