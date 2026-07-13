import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { queryKeys, repoCollaboratorsQueryOptions } from "@/lib/query-options";
import {
	addCollaboratorByUsername,
	removeCollaborator,
} from "@/server/repositories";

export function CollaboratorsSection({ repoId }: { repoId: number }) {
	const queryClient = useQueryClient();
	const [username, setUsername] = useState("");
	const [role, setRole] = useState<"read" | "write" | "admin">("write");
	const [addError, setAddError] = useState("");

	const { data: collabs = [] } = useQuery(
		repoCollaboratorsQueryOptions(repoId),
	);

	const addMutation = useMutation({
		mutationFn: addCollaboratorByUsername,
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.repoCollaborators(repoId),
			});
			setUsername("");
			setAddError("");
		},
		onError: (e: Error) => setAddError(e.message),
	});

	const removeMutation = useMutation({
		mutationFn: removeCollaborator,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: queryKeys.repoCollaborators(repoId),
			}),
	});

	return (
		<Section
			title="Collaborators"
			description="People with access to this repository."
		>
			<div className="space-y-4">
				{collabs.length > 0 ? (
					<ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
						{collabs.map((c) => (
							<li
								key={c.id}
								className="flex items-center justify-between gap-3 px-4 py-3"
							>
								<div className="flex items-center gap-2 min-w-0">
									<span className="truncate text-sm font-medium text-[var(--sea-ink)]">
										{c.user?.username ?? c.userId}
									</span>
									<span className="shrink-0 rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--sea-ink-soft)] capitalize">
										{c.role}
									</span>
								</div>
								<Button
									variant="outline"
									size="sm"
									disabled={removeMutation.isPending}
									onClick={() =>
										removeMutation.mutate({
											data: { repoId, userId: c.userId },
										})
									}
								>
									Remove
								</Button>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-[var(--sea-ink-soft)]">
						No collaborators yet.
					</p>
				)}

				<div className="flex gap-2">
					<Input
						className="flex-1"
						placeholder="Username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && username.trim())
								addMutation.mutate({
									data: { repoId, username: username.trim(), role },
								});
						}}
					/>
					<Select
						value={role}
						onValueChange={(value) => setRole(value as typeof role)}
					>
						<SelectTrigger className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="read">Read</SelectItem>
							<SelectItem value="write">Write</SelectItem>
							<SelectItem value="admin">Admin</SelectItem>
						</SelectContent>
					</Select>
					<LoadingButton
						isLoading={addMutation.isPending}
						loadingLabel="Adding…"
						disabled={!username.trim()}
						onClick={() =>
							addMutation.mutate({
								data: { repoId, username: username.trim(), role },
							})
						}
					>
						Add
					</LoadingButton>
				</div>
				{addError && (
					<p className="text-sm text-red-600 dark:text-red-400">{addError}</p>
				)}
			</div>
		</Section>
	);
}
