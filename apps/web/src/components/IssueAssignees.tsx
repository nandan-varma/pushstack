import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { MAX_ASSIGNEES } from "@/lib/limits";
import { assignableUsersQueryOptions, queryKeys } from "@/lib/query-options";
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

	if (!canEdit && assignees.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-2 text-sm">
			<span className="text-muted-foreground">Assignees</span>
			{assignees.length === 0 ? (
				<span className="text-muted-foreground">No one</span>
			) : (
				assignees.map((a) => (
					<Link
						key={a.id}
						to="/users/$username"
						params={{ username: a.username }}
						className="font-medium text-foreground"
					>
						{a.username}
					</Link>
				))
			)}
			{canEdit && (
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-xs text-muted-foreground"
					onClick={() => setIsEditing((v) => !v)}
				>
					{isEditing ? "Done" : "Edit"}
				</Button>
			)}
			{canEdit && isEditing && (
				<ul className="w-full space-y-1 rounded-lg border border-border p-2">
					{(assignable ?? []).map((u) => (
						<li key={u.id}>
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={selected.has(u.username)}
									disabled={
										mutation.isPending ||
										(!selected.has(u.username) &&
											selected.size >= MAX_ASSIGNEES)
									}
									onChange={() => toggle(u.username)}
								/>
								<span>{u.username}</span>
								<span className="text-muted-foreground">{u.name}</span>
							</label>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
