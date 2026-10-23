import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";
import { Panel } from "@/components/layout/panel";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";
import { getSession } from "@/lib/auth-session";
import { queryKeys, repositoryByNameQueryOptions } from "@/lib/query-options";
import {
	MAX_STORAGE_NAME_LENGTH,
	STORAGE_NAME_HINT,
	STORAGE_NAME_PATTERN,
} from "@/lib/storage-name";
import { generateRepository } from "@/server/repositories";

export const Route = createFileRoute("/$owner/$name/generate")({
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) throw redirect({ to: "/login" });
		return { user: session.user };
	},
	loader: ({ params, context: { queryClient } }) =>
		queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		),
	component: GenerateRepositoryPage,
});

function GenerateRepositoryPage() {
	const { owner, name: templateName } = Route.useParams();
	const { user } = Route.useRouteContext();
	const template = Route.useLoaderData();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState(template?.description ?? "");
	const [visibility, setVisibility] = useState<"public" | "private">("public");
	const [error, setError] = useState("");

	const generate = useMutation({
		mutationFn: generateRepository,
		onSuccess: async (repo) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.repositoriesRoot,
			});
			navigate({
				to: "/$owner/$name",
				params: { owner: repo.owner.username, name: repo.name },
			});
		},
		onError: (err: Error) => setError(err.message),
	});

	if (!template?.isTemplate) {
		return (
			<p className="py-6 text-sm text-muted-foreground">
				{owner}/{templateName} is not a template repository.
			</p>
		);
	}

	return (
		<div className="space-y-5 py-2">
			<PageHeader
				title="Create a repository from a template"
				description={`Copies the files of ${owner}/${templateName} into a new repository, without its history.`}
			/>
			<Panel className="max-w-[640px] p-5 sm:p-6">
				<form
					className="space-y-6"
					onSubmit={(e) => {
						e.preventDefault();
						setError("");
						generate.mutate({
							data: {
								templateId: template.id,
								name,
								description,
								visibility,
							},
						});
					}}
				>
					{error && (
						<div
							role="alert"
							className="rounded-[12px] border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive"
						>
							{error}
						</div>
					)}
					<div className="space-y-2">
						<Label htmlFor="generate-name">Repository name</Label>
						<div className="flex items-center gap-2">
							<span className="shrink-0 text-sm text-muted-foreground">
								{user.username}/
							</span>
							<Input
								id="generate-name"
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
						<Label htmlFor="generate-description">Description (optional)</Label>
						<Textarea
							id="generate-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
						/>
					</div>
					<div className="flex gap-3">
						{(["public", "private"] as const).map((v) => (
							<label
								key={v}
								className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
									visibility === v
										? "border-primary font-medium text-primary"
										: "border-border text-muted-foreground"
								}`}
							>
								<input
									type="radio"
									className="sr-only"
									name="visibility"
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
					<LoadingButton
						type="submit"
						isLoading={generate.isPending}
						loadingLabel="Creating…"
						disabled={!name.trim()}
					>
						Create repository
					</LoadingButton>
				</form>
			</Panel>
		</div>
	);
}
