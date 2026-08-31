import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCloneUrl, getSetupInstructions } from "@/lib/git-utils";
import {
	authSessionQueryOptions,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/repo/$owner/$name/setup")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			// Only used for a branch count display below — fire-and-forget
			// (same pattern as the tree page's loader) rather than blocking
			// route commit on it.
			queryClient
				.ensureQueryData(repositoryBranchesQueryOptions(repo.id))
				.catch(() => {});
		}
	},
	component: RouteComponent,
});

function RouteComponent() {
	const { owner, name } = Route.useParams();
	const { data: session } = useQuery(authSessionQueryOptions());
	const [copiedSection, setCopiedSection] = useState<string | null>(null);

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	const cloneUrl = getCloneUrl(owner, name, "https");
	const instructions = getSetupInstructions(owner, name, cloneUrl);
	const defaultBranch = repo?.defaultBranch || "main";
	const isOwner = repo?.ownerId === session?.user?.id;

	const handleCopy = async (value: string, key: string) => {
		await navigator.clipboard.writeText(value);
		setCopiedSection(key);
		window.setTimeout(() => setCopiedSection(null), 2000);
	};

	if (!repo) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-36" />
				<Skeleton className="h-48" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<Link
					to="/repo/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch: defaultBranch, _splat: "" }}
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="size-4" />
					{owner}/{name}
				</Link>
			</div>
			<Card className="p-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-2xl font-semibold text-foreground">
							Repository Setup
						</h2>
						<p className="mt-2 text-sm text-muted-foreground">
							Git, R2-backed object storage, and SQL metadata are configured for
							this repository.
						</p>
					</div>
					<Link
						to="/repo/$owner/$name/tree/$branch/$"
						params={{ owner, name, branch: defaultBranch, _splat: "" }}
					>
						<Button variant="outline">Back to Code</Button>
					</Link>
				</div>
			</Card>

			<Card className="p-6">
				<h3 className="text-lg font-semibold text-foreground">Clone URL</h3>
				<p className="mt-2 text-sm text-muted-foreground">
					Use this remote for clone, fetch, pull, and push.
				</p>
				<div className="mt-4 flex flex-wrap gap-2">
					<input
						readOnly
						value={cloneUrl}
						className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
					/>
					<Button variant="outline" onClick={() => handleCopy(cloneUrl, "url")}>
						{copiedSection === "url" ? "Copied" : "Copy"}
					</Button>
				</div>
			</Card>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card className="p-6">
					<h3 className="text-lg font-semibold text-foreground">
						Repository Status
					</h3>
					<dl className="mt-4 space-y-3 text-sm">
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Visibility</dt>
							<dd className="font-medium text-foreground">{repo.visibility}</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Default branch</dt>
							<dd className="font-medium text-foreground">{defaultBranch}</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Branches</dt>
							<dd className="font-medium text-foreground">
								{branches?.length || 0}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Storage</dt>
							<dd className="font-medium text-foreground">Git objects in R2</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Metadata</dt>
							<dd className="font-medium text-foreground">SQL-backed</dd>
						</div>
					</dl>
				</Card>

				<Card className="p-6">
					<h3 className="text-lg font-semibold text-foreground">
						Next Actions
					</h3>
					<div className="mt-4 flex flex-col gap-3">
						<Link
							to="/repo/$owner/$name/commits/$branch"
							params={{ owner, name, branch: defaultBranch }}
						>
							<Button variant="outline" className="w-full justify-start">
								View commit history
							</Button>
						</Link>
						<Link to="/repo/$owner/$name/pulls" params={{ owner, name }}>
							<Button variant="outline" className="w-full justify-start">
								Open pull requests
							</Button>
						</Link>
						{isOwner && (
							<Link to="/repo/$owner/$name/upload" params={{ owner, name }}>
								<Button className="w-full justify-start">
									Add files in the web UI
								</Button>
							</Link>
						)}
					</div>
				</Card>
			</div>

			<Card className="p-6">
				<h3 className="text-lg font-semibold text-foreground">
					Push a New Repository
				</h3>
				<pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-xs text-foreground">
					<code>{instructions.newRepo}</code>
				</pre>
				<Button
					className="mt-4"
					variant="outline"
					onClick={() => handleCopy(instructions.newRepo, "new")}
				>
					{copiedSection === "new" ? "Copied" : "Copy commands"}
				</Button>
			</Card>

			<Card className="p-6">
				<h3 className="text-lg font-semibold text-foreground">
					Push an Existing Repository
				</h3>
				<pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-xs text-foreground">
					<code>{instructions.existingRepo}</code>
				</pre>
				<Button
					className="mt-4"
					variant="outline"
					onClick={() => handleCopy(instructions.existingRepo, "existing")}
				>
					{copiedSection === "existing" ? "Copied" : "Copy commands"}
				</Button>
			</Card>
		</div>
	);
}
