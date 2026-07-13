import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";
import { Section } from "@/components/Section";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { queryKeys } from "@/lib/query-options";
import { updateRepository } from "@/server/repositories";

const labelCls = "text-sm font-medium text-[var(--sea-ink)]";

export function GeneralSection({
	repo,
	owner,
	name,
}: {
	repo: {
		id: number;
		name: string;
		description: string | null;
		visibility: string;
	};
	owner: string;
	name: string;
}) {
	const queryClient = useQueryClient();
	const [repoName, setRepoName] = useState(repo.name);
	const [description, setDescription] = useState(repo.description ?? "");
	const [visibility, setVisibility] = useState<"public" | "private">(
		repo.visibility as "public" | "private",
	);
	const [success, setSuccess] = useState(false);

	const updateMutation = useMutation({
		mutationFn: updateRepository,
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.repositoryByName(owner, name),
			});
			setSuccess(true);
			setTimeout(() => setSuccess(false), 2500);
		},
	});

	const dirty =
		repoName !== repo.name ||
		description !== (repo.description ?? "") ||
		visibility !== repo.visibility;

	return (
		<Section title="General" description="Basic repository information.">
			<div className="space-y-4">
				<FormField label="Repository name" htmlFor="repo-name">
					<Input
						id="repo-name"
						value={repoName}
						onChange={(e) => setRepoName(e.target.value)}
					/>
				</FormField>
				<FormField label="Description" htmlFor="repo-desc" hint="(optional)">
					<Input
						id="repo-desc"
						value={description}
						placeholder="A short description of this repository"
						onChange={(e) => setDescription(e.target.value)}
					/>
				</FormField>
				<div>
					<p className={labelCls}>Visibility</p>
					<div className="flex gap-3">
						{(["public", "private"] as const).map((v) => (
							<label
								key={v}
								className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 text-sm transition ${
									visibility === v
										? "border-[var(--lagoon-deep)] bg-[var(--lagoon-deep)]/5 font-medium text-[var(--lagoon-deep)]"
										: "border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon-deep)]/50"
								}`}
							>
								<input
									type="radio"
									className="sr-only"
									name="visibility"
									value={v}
									checked={visibility === v}
									onChange={() => setVisibility(v)}
								/>
								{v === "public" ? (
									<Globe className="size-4" />
								) : (
									<Lock className="size-4" />
								)}
								<span className="capitalize">{v}</span>
							</label>
						))}
					</div>
				</div>
				{updateMutation.isError && (
					<p className="text-sm text-red-600 dark:text-red-400">
						{(updateMutation.error as Error).message}
					</p>
				)}
				<div className="flex items-center gap-3">
					<LoadingButton
						isLoading={updateMutation.isPending}
						loadingLabel="Saving…"
						disabled={!dirty || !repoName.trim()}
						onClick={() =>
							updateMutation.mutate({
								data: { id: repo.id, name: repoName, description, visibility },
							})
						}
					>
						Save changes
					</LoadingButton>
					{success && (
						<span className="text-sm text-green-600 dark:text-green-400">
							Saved
						</span>
					)}
				</div>
			</div>
		</Section>
	);
}
