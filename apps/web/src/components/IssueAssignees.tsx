import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Settings2 } from "lucide-react";
import { useState } from "react";
import { AsideSection } from "@/components/layout/page";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { MAX_ASSIGNEES } from "@/lib/limits";
import {
	assignableUsersQueryOptions,
	authSessionQueryOptions,
	queryKeys,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";
import { setIssueAssignees, setPullRequestAssignees } from "@/server/assignees";

interface Person {
	id: string;
	username: string;
	name: string;
}

/**
 * An issue or pull request's assignees. Anyone sees them; with write access (`canEdit`) the
 * viewer can pick from the repository's assignable users — its owner and
 * write/admin collaborators — as on GitHub.
 */
export function IssueAssignees({
	issueId,
	pullRequestId,
	repoId,
	assignees,
	canEdit,
	onChanged,
}: {
	issueId?: number;
	pullRequestId?: number;
	repoId: number;
	assignees: Person[];
	canEdit: boolean;
	onChanged: () => void;
}) {
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const [isEditing, setIsEditing] = useState(false);
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: assignable } = useQuery({
		...assignableUsersQueryOptions(repoId),
		enabled: canEdit && isEditing,
	});
	const mutation = useMutation({
		mutationFn: (usernames: string[]) => {
			if (pullRequestId !== undefined)
				return setPullRequestAssignees({ data: { pullRequestId, usernames } });
			if (issueId !== undefined)
				return setIssueAssignees({ data: { issueId, usernames } });
			throw new Error("Missing thread");
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.assignedThreads }),
				queryClient.invalidateQueries({
					queryKey: queryKeys.pullRequestsRoot(repoId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoIssuesRoot(repoId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(repoId),
				}),
			]);
			onChanged();
		},
		onError: (err: Error) => toast(err.message || "Failed to assign", "error"),
	});
	const selected = new Set(assignees.map((a) => a.username));

	const toggle = (username: string) => {
		const next = new Set(selected);
		if (next.has(username)) next.delete(username);
		else next.add(username);
		mutation.mutate([...next]);
	};

	const viewerUsername = session?.user?.username ?? undefined;
	const canSelfAssign =
		canEdit &&
		viewerUsername !== undefined &&
		!selected.has(viewerUsername) &&
		selected.size < MAX_ASSIGNEES;

	return (
		<AsideSection
			title="Assignees"
			action={
				canEdit && (
					<button
						type="button"
						className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
						aria-label={isEditing ? "Done editing assignees" : "Edit assignees"}
						aria-expanded={isEditing}
						onClick={() => setIsEditing((v) => !v)}
					>
						{isEditing ? <Check /> : <Settings2 />}
					</button>
				)
			}
		>
			{assignees.length === 0 ? (
				<p className="text-sm text-bjork-text-soft">
					No one
					{canSelfAssign && (
						<>
							{" — "}
							<button
								type="button"
								disabled={mutation.isPending}
								onClick={() => toggle(viewerUsername)}
								className="text-bjork-text-medium hover:text-bjork-accent"
							>
								assign yourself
							</button>
						</>
					)}
				</p>
			) : (
				<ul className="space-y-2">
					{assignees.map((a) => (
						<li key={a.id}>
							<Link
								to="/$owner"
								params={{ owner: a.username }}
								className="flex items-center gap-2 text-sm font-medium text-bjork-text hover:text-bjork-accent"
							>
								<Avatar size="sm">
									<AvatarFallback className="text-[11px]">
										{getInitials(a.name || a.username)}
									</AvatarFallback>
								</Avatar>
								{a.username}
							</Link>
						</li>
					))}
				</ul>
			)}
			{canEdit && isEditing && (
				<ul className="mt-3 space-y-0.5 rounded-[14px] border border-bjork-border bg-bjork-field-inset p-1.5 shadow-(--bjork-shadow-inset)">
					{(assignable ?? []).map((u) => (
						<li key={u.id}>
							<label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-sm hover:bg-bjork-surface-hover">
								<input
									type="checkbox"
									className="size-4 accent-[var(--bjork-accent)]"
									checked={selected.has(u.username)}
									disabled={
										mutation.isPending ||
										(!selected.has(u.username) &&
											selected.size >= MAX_ASSIGNEES)
									}
									onChange={() => toggle(u.username)}
								/>
								<span className="font-medium text-bjork-text">
									{u.username}
								</span>
								<span className="truncate text-bjork-text-soft">{u.name}</span>
							</label>
						</li>
					))}
				</ul>
			)}
		</AsideSection>
	);
}
