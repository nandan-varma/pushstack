import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getSession } from "@/lib/auth-session";
import { queryKeys } from "@/lib/query-options";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { LoadingButton } from "../../components/ui/loading-button";
import { Textarea } from "../../components/ui/textarea";
import { createRepository } from "../../server/repositories";

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
				to: "/repo/$owner/$name",
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
		createRepoMutation.mutate({ data: { name, description, visibility } });
	};

	return (
		<div className="page-wrap px-4 py-10">
			<div className="mx-auto max-w-2xl">
				<div className="mb-8">
					<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
						Create a new repository
					</h1>
					<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
						A repository contains all project files and revision history.
					</p>
				</div>

				<div className="island-shell rounded-2xl p-8">
					<form onSubmit={handleSubmit} className="space-y-6">
						{error && (
							<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
								{error}
							</div>
						)}

						<div className="space-y-1.5">
							<Label htmlFor="name">Repository name</Label>
							<div className="flex items-center gap-2">
								<span className="shrink-0 text-sm text-[var(--sea-ink-soft)]">
									{ownerHandle}/
								</span>
								<Input
									id="name"
									type="text"
									placeholder="my-awesome-project"
									value={name}
									onChange={(e) => setName(e.target.value)}
									required
									pattern="[a-zA-Z0-9-_]+"
									title="Only letters, numbers, hyphens, and underscores"
									className="flex-1"
								/>
							</div>
						</div>

						<div className="space-y-1.5">
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
							<legend className="text-sm font-medium text-[var(--sea-ink)]">
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
										className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
											visibility === value
												? "border-[var(--lagoon-deep)] bg-[rgba(79,184,178,0.04)]"
												: "border-[var(--line)] hover:border-[var(--lagoon-deep)]/50"
										}`}
									>
										<input
											type="radio"
											name="visibility"
											value={value}
											checked={visibility === value}
											onChange={() => setVisibility(value)}
											className="mt-0.5 accent-[var(--lagoon-deep)]"
										/>
										<div>
											<div className="text-sm font-medium text-[var(--sea-ink)]">
												{label}
											</div>
											<div className="mt-0.5 text-xs text-[var(--sea-ink-soft)]">
												{desc}
											</div>
										</div>
									</label>
								))}
							</div>
						</fieldset>

						<div className="flex gap-3 pt-2">
							<LoadingButton
								type="submit"
								isLoading={createRepoMutation.isPending}
								loadingLabel="Creating…"
							>
								Create repository
							</LoadingButton>
							<Button
								type="button"
								variant="outline"
								disabled={createRepoMutation.isPending}
								onClick={() => navigate({ to: "/dashboard" })}
							>
								Cancel
							</Button>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}
