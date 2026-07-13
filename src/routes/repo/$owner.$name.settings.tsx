import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { CollaboratorsSection } from "@/components/settings/CollaboratorsSection";
import { DangerSection } from "@/components/settings/DangerSection";
import { GeneralSection } from "@/components/settings/GeneralSection";
import { Button } from "@/components/ui/button";
import {
	authSessionQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/repo/$owner/$name/settings")({
	component: RepoSettingsPage,
});

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
				<div className="flex items-center justify-between gap-3">
					<Link
						to="/repo/$owner/$name/tree/$branch/$"
						params={{
							owner,
							name,
							branch: repo?.defaultBranch || "main",
							_splat: "",
						}}
						className="flex items-center gap-1 text-sm text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
					>
						<ArrowLeft className="size-4" />
						{owner}/{name}
					</Link>
					<Link
						to="/repo/$owner/$name/setup"
						params={{ owner, name }}
						className="text-sm font-medium text-[var(--lagoon-deep)] hover:underline"
					>
						View setup guide
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
