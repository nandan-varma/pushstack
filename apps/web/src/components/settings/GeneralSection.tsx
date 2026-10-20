import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";
import { Section } from "@/components/Section";
import { FieldError } from "@/components/ui/field-error";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { queryKeys, repositoryBranchesQueryOptions } from "@/lib/query-options";
import { updateRepository } from "@/server/repositories";

const labelCls = "text-sm font-medium text-foreground";

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
		defaultBranch: string;
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
	const [defaultBranch, setDefaultBranch] = useState(repo.defaultBranch);
	const [success, setSuccess] = useState(false);
	const navigate = useNavigate();
	const { data: branches = [] } = useQuery(
		repositoryBranchesQueryOptions(repo.id),
	);

	const updateMutation = useMutation({
		mutationFn: updateRepository,
		onSuccess: (updated) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.repositoryByName(owner, name),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.repoBranches(repo.id),
			});
			// A rename moves the repo: this page's URL no longer exists.
			if (updated.name !== name) {
				navigate({
					to: "/repo/$owner/$name/settings",
					params: { owner, name: updated.name },
					replace: true,
				});
				return;
			}
			setSuccess(true);
			setTimeout(() => setSuccess(false), 2500);
		},
	});

	const dirty =
		repoName !== repo.name ||
		description !== (repo.description ?? "") ||
		visibility !== repo.visibility ||
		defaultBranch !== repo.defaultBranch;

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
				<FormField label="Default branch" htmlFor="repo-default-branch">
					<Select
						value={defaultBranch}
						onValueChange={(value) => value && setDefaultBranch(value)}
					>
						<SelectTrigger id="repo-default-branch" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(branches.length > 0
								? branches.map((b) => b.name)
								: [repo.defaultBranch]
							).map((branch) => (
								<SelectItem key={branch} value={branch}>
									{branch}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="mt-1 text-xs text-muted-foreground">
						Shown when the repository opens, and checked out by git clone.
					</p>
				</FormField>
				<div>
					<p className={labelCls}>Visibility</p>
					<div className="flex gap-3">
						{(["public", "private"] as const).map((v) => (
							<label
								key={v}
								className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 text-sm transition ${
									visibility === v
										? "border-primary bg-[var(--primary)]/5 font-medium text-primary"
										: "border-border text-muted-foreground hover:border-primary/50"
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
					<FieldError>{(updateMutation.error as Error).message}</FieldError>
				)}
				<div className="flex items-center gap-3">
					<LoadingButton
						isLoading={updateMutation.isPending}
						loadingLabel="Saving…"
						disabled={!dirty || !repoName.trim()}
						onClick={() =>
							updateMutation.mutate({
								data: {
									id: repo.id,
									name: repoName,
									description,
									visibility,
									defaultBranch,
								},
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
