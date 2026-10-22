import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { getSession } from "@/lib/auth-session";
import { queryKeys } from "@/lib/query-options";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { LoadingButton } from "../../components/ui/loading-button";
import { Textarea } from "../../components/ui/textarea";
import {
	MAX_STORAGE_NAME_LENGTH,
	STORAGE_NAME_HINT,
	STORAGE_NAME_PATTERN,
} from "../../lib/storage-name";
import {
	GITIGNORE_TEMPLATE_NAMES,
	type GitignoreTemplateName,
	LICENSE_TEMPLATE_KEYS,
	LICENSE_TEMPLATE_LABELS,
	type LicenseTemplateKey,
} from "../../lib/templates/names";
import { createRepository } from "../../server/repositories";

const NONE = "none";

export const Route = createFileRoute("/repositories/new")({
	component: NewRepositoryPage,
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) {
			throw redirect({ to: "/auth/login" });
		}
		return { user: session.user };
	},
});

function NewRepositoryPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { user } = Route.useRouteContext();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [visibility, setVisibility] = useState<"public" | "private">("public");
	const [autoInit, setAutoInit] = useState(false);
	const [gitignoreTemplate, setGitignoreTemplate] = useState<
		GitignoreTemplateName | typeof NONE
	>(NONE);
	const [licenseTemplate, setLicenseTemplate] = useState<
		LicenseTemplateKey | typeof NONE
	>(NONE);
	const [error, setError] = useState("");

	const ownerHandle = user.username || user.email.split("@")[0];

	const createRepoMutation = useMutation({
		mutationFn: createRepository,
		onSuccess: async (repo) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot }),
				queryClient.invalidateQueries({
					queryKey: queryKeys.userActivity(user.id, 20),
				}),
			]);
			navigate({
				to: "/$owner/$name",
				params: { owner: repo.owner.username || ownerHandle, name: repo.name },
			});
		},
		onError: (err: Error) => {
			setError(err.message || "Failed to create repository");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		if (!name.trim()) {
			setError("Repository name is required");
			return;
		}
		createRepoMutation.mutate({
			data: {
				name,
				description,
				visibility,
				autoInit,
				gitignoreTemplate:
					gitignoreTemplate === NONE ? undefined : gitignoreTemplate,
				licenseTemplate: licenseTemplate === NONE ? undefined : licenseTemplate,
			},
		});
	};

	return (
		<div className="page-wrap py-6 sm:py-8">
			<div className="max-w-xl">
				<PageHeader
					title="Create a new repository"
					description="A repository contains all project files and revision history."
				/>

				<div className="island-shell rounded-[20px] p-5 sm:p-6">
					<form onSubmit={handleSubmit} className="space-y-6">
						{error && (
							<div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
								{error}
							</div>
						)}

						<div className="space-y-2">
							<Label htmlFor="name">Repository name</Label>
							<div className="flex items-center gap-2">
								<span className="shrink-0 text-sm text-muted-foreground">
									{ownerHandle}/
								</span>
								<Input
									id="name"
									type="text"
									placeholder="my-awesome-project"
									value={name}
									onChange={(e) => setName(e.target.value)}
									required
									pattern={STORAGE_NAME_PATTERN}
									maxLength={MAX_STORAGE_NAME_LENGTH}
									title={STORAGE_NAME_HINT}
									className="flex-1"
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description (optional)</Label>
							<Textarea
								id="description"
								placeholder="A brief description of your repository"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								rows={2}
							/>
						</div>

						<fieldset className="space-y-2">
							<legend className="text-sm font-medium text-foreground">
								Visibility
							</legend>
							<div className="space-y-2">
								{(
									[
										[
											"public",
											"Public",
											"Anyone on PushStack can see this repository.",
										],
										[
											"private",
											"Private",
											"Only you and collaborators can see this.",
										],
									] as const
								).map(([value, label, desc]) => (
									<label
										key={value}
										className={`flex cursor-pointer items-start gap-3 rounded-[13px] border p-4 shadow-[var(--bjork-shadow-inset)] transition-colors ${
											visibility === value
												? "border-primary bg-primary/5"
												: "border-border hover:border-primary/50"
										}`}
									>
										<input
											type="radio"
											name="visibility"
											value={value}
											checked={visibility === value}
											onChange={() => setVisibility(value)}
											className="mt-0.5 accent-[var(--primary)]"
										/>
										<div>
											<div className="text-sm font-medium text-foreground">
												{label}
											</div>
											<div className="mt-0.5 text-xs text-muted-foreground">
												{desc}
											</div>
										</div>
									</label>
								))}
							</div>
						</fieldset>

						<fieldset className="space-y-4">
							<legend className="text-sm font-medium text-foreground">
								Initialize this repository with
							</legend>
							<label className="flex cursor-pointer items-start gap-3">
								<input
									type="checkbox"
									checked={autoInit}
									onChange={(e) => setAutoInit(e.target.checked)}
									className="mt-0.5 accent-[var(--primary)]"
								/>
								<div>
									<div className="text-sm font-medium text-foreground">
										Add a README file
									</div>
									<div className="mt-0.5 text-xs text-muted-foreground">
										A good place to describe your project.
									</div>
								</div>
							</label>
							<div className="space-y-2">
								<Label htmlFor="gitignore-template">.gitignore template</Label>
								<Select
									value={gitignoreTemplate}
									onValueChange={(value) =>
										setGitignoreTemplate(value as typeof gitignoreTemplate)
									}
								>
									<SelectTrigger id="gitignore-template" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NONE}>No .gitignore</SelectItem>
										{GITIGNORE_TEMPLATE_NAMES.map((template) => (
											<SelectItem key={template} value={template}>
												{template}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="license-template">License</Label>
								<Select
									value={licenseTemplate}
									onValueChange={(value) =>
										setLicenseTemplate(value as typeof licenseTemplate)
									}
								>
									<SelectTrigger id="license-template" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NONE}>No license</SelectItem>
										{LICENSE_TEMPLATE_KEYS.map((key) => (
											<SelectItem key={key} value={key}>
												{LICENSE_TEMPLATE_LABELS[key]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</fieldset>

						<div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-6">
							<Button
								type="button"
								variant="outline"
								disabled={createRepoMutation.isPending}
								onClick={() => navigate({ to: "/dashboard" })}
							>
								Cancel
							</Button>
							<LoadingButton
								type="submit"
								isLoading={createRepoMutation.isPending}
								loadingLabel="Creating…"
							>
								Create repository
							</LoadingButton>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}
