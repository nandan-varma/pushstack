import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	authSessionQueryOptions,
	queryKeys,
	repoCollaboratorsQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import {
	addCollaboratorByUsername,
	deleteRepository,
	removeCollaborator,
	updateRepository,
} from "@/server/repositories";

export const Route = createFileRoute("/repo/$owner/$name/settings")({
	component: RepoSettingsPage,
});

const inputCls =
	"w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]";
const labelCls = "block text-sm font-medium text-[var(--sea-ink)] mb-1";

function Section({
	title,
	description,
	danger,
	children,
}: {
	title: string;
	description?: string;
	danger?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Card
			className={`p-6 ${danger ? "border-red-300 dark:border-red-800/50" : ""}`}
		>
			<h2
				className={`mb-1 text-base font-semibold ${danger ? "text-red-700 dark:text-red-400" : "text-[var(--sea-ink)]"}`}
			>
				{title}
			</h2>
			{description && (
				<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">{description}</p>
			)}
			{children}
		</Card>
	);
}

function GeneralSection({
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
				<div>
					<label htmlFor="repo-name" className={labelCls}>
						Repository name
					</label>
					<input
						id="repo-name"
						className={inputCls}
						value={repoName}
						onChange={(e) => setRepoName(e.target.value)}
					/>
				</div>
				<div>
					<label htmlFor="repo-desc" className={labelCls}>
						Description{" "}
						<span className="font-normal text-[var(--sea-ink-soft)]">
							(optional)
						</span>
					</label>
					<input
						id="repo-desc"
						className={inputCls}
						value={description}
						placeholder="A short description of this repository"
						onChange={(e) => setDescription(e.target.value)}
					/>
				</div>
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
								<span>{v === "public" ? "🌐" : "🔒"}</span>
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
					<Button
						disabled={!dirty || updateMutation.isPending || !repoName.trim()}
						onClick={() =>
							updateMutation.mutate({
								data: { id: repo.id, name: repoName, description, visibility },
							})
						}
					>
						{updateMutation.isPending ? "Saving…" : "Save changes"}
					</Button>
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

function CollaboratorsSection({ repoId }: { repoId: number }) {
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
				{/* Existing collaborators */}
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

				{/* Add collaborator */}
				<div className="flex gap-2">
					<input
						className={`${inputCls} flex-1`}
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
					<select
						className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
						value={role}
						onChange={(e) => setRole(e.target.value as typeof role)}
					>
						<option value="read">Read</option>
						<option value="write">Write</option>
						<option value="admin">Admin</option>
					</select>
					<Button
						disabled={!username.trim() || addMutation.isPending}
						onClick={() =>
							addMutation.mutate({
								data: { repoId, username: username.trim(), role },
							})
						}
					>
						{addMutation.isPending ? "Adding…" : "Add"}
					</Button>
				</div>
				{addError && (
					<p className="text-sm text-red-600 dark:text-red-400">{addError}</p>
				)}
			</div>
		</Section>
	);
}

function DangerSection({
	repo,
	owner,
	name,
}: {
	repo: { id: number };
	owner: string;
	name: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");

	const deleteMutation = useMutation({
		mutationFn: () => deleteRepository({ data: { id: repo.id } }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["repositories"] });
			navigate({ to: "/repositories" });
		},
		onError: (e: Error) => setError(e.message),
	});

	return (
		<Section
			danger
			title="Danger zone"
			description={`Permanently delete ${owner}/${name} and all its data. This cannot be undone.`}
		>
			{error && (
				<p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
			)}
			<div className="flex gap-3">
				<input
					className={`${inputCls} flex-1`}
					placeholder={`Type "${name}" to confirm`}
					value={confirm}
					onChange={(e) => setConfirm(e.target.value)}
				/>
				<Button
					variant="destructive"
					disabled={confirm !== name || deleteMutation.isPending || !repo}
					onClick={() => deleteMutation.mutate()}
				>
					{deleteMutation.isPending ? "Deleting…" : "Delete repository"}
				</Button>
			</div>
		</Section>
	);
}

function RepoSettingsPage() {
	const { owner, name } = Route.useParams();
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: repo, isLoading } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	if (isLoading) {
		return (
			<div className="page-wrap px-4 py-10">
				<div className="mx-auto max-w-2xl space-y-4">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-40 animate-pulse rounded-2xl bg-[var(--surface-raised)]"
						/>
					))}
				</div>
			</div>
		);
	}

	if (!repo) {
		return (
			<div className="page-wrap px-4 py-10 text-center">
				<p className="text-[var(--sea-ink-soft)]">Repository not found.</p>
				<Link to="/repositories">
					<Button className="mt-4" size="sm">
						Back
					</Button>
				</Link>
			</div>
		);
	}

	const isOwner = repo.ownerId === session?.user?.id;
	if (!isOwner) {
		return (
			<div className="page-wrap px-4 py-10 text-center">
				<p className="text-[var(--sea-ink-soft)]">
					You don't have permission to view settings.
				</p>
			</div>
		);
	}

	return (
		<div className="page-wrap px-4 py-10">
			<div className="mx-auto max-w-2xl space-y-6">
				<div className="flex items-center gap-3">
					<Link
						to="/repo/$owner/$name"
						params={{ owner, name }}
						className="text-sm text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
					>
						← {owner}/{name}
					</Link>
				</div>
				<h1 className="text-2xl font-bold text-[var(--sea-ink)]">Settings</h1>

				<GeneralSection repo={repo} owner={owner} name={name} />
				<CollaboratorsSection repoId={repo.id} />
				<DangerSection repo={repo} owner={owner} name={name} />
			</div>
		</div>
	);
}
