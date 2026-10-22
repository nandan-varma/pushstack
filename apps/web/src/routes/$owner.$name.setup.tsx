import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getCloneUrl, getSetupInstructions } from "@/lib/git-utils";
import {
	authSessionQueryOptions,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/setup")({
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

	const cloneUrl = getCloneUrl(owner, name);
	const instructions = getSetupInstructions(name, cloneUrl);
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

	const { defaultBranch } = repo;

	return (
		<div className="max-w-xl space-y-4">
			<PageHeader
				title="Repository Setup"
				description="Git, R2-backed object storage, and SQL metadata are configured for this repository."
				actions={
					<>
						<Link
							to="/$owner/$name/tree/$branch/$"
							params={{ owner, name, branch: defaultBranch, _splat: "" }}
							className="flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="size-4" />
							{owner}/{name}
						</Link>
						<Button variant="outline" asChild>
							<Link
								to="/$owner/$name/tree/$branch/$"
								params={{ owner, name, branch: defaultBranch, _splat: "" }}
							>
								Back to Code
							</Link>
						</Button>
					</>
				}
			/>

			<Card className="p-5">
				<h2 className="text-base font-semibold tracking-tight text-foreground">
					Clone URL
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					Use this remote for clone, fetch, pull, and push.
				</p>
				<div className="mt-4 flex flex-wrap gap-2">
					<Input
						readOnly
						value={cloneUrl}
						className="min-w-0 flex-1 font-mono text-sm"
					/>
					<Button variant="outline" onClick={() => handleCopy(cloneUrl, "url")}>
						{copiedSection === "url" ? "Copied" : "Copy"}
					</Button>
				</div>
			</Card>

			<div className="grid gap-4 md:grid-cols-2">
				<Card className="p-5">
					<h2 className="text-base font-semibold tracking-tight text-foreground">
						Repository Status
					</h2>
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

				<Card className="p-5">
					<h2 className="text-base font-semibold tracking-tight text-foreground">
						Next Actions
					</h2>
					<div className="mt-4 flex flex-col gap-3">
						<Link
							to="/$owner/$name/commits/$branch"
							params={{ owner, name, branch: defaultBranch }}
						>
							<Button variant="outline" className="w-full justify-start">
								View commit history
							</Button>
						</Link>
						<Link to="/$owner/$name/pulls" params={{ owner, name }}>
							<Button variant="outline" className="w-full justify-start">
								Open pull requests
							</Button>
						</Link>
						{isOwner && (
							<Link to="/$owner/$name/upload" params={{ owner, name }}>
								<Button className="w-full justify-start">
									Add files in the web UI
								</Button>
							</Link>
						)}
					</div>
				</Card>
			</div>

			<Card className="p-5">
				<h2 className="text-base font-semibold tracking-tight text-foreground">
					Push a New Repository
				</h2>
				<pre className="mt-4 overflow-x-auto rounded-[13px] border border-border bg-muted p-4 shadow-[var(--bjork-shadow-inset)] text-xs text-foreground">
					<code>{instructions.newRepo}</code>
				</pre>
				<div className="mt-4 flex justify-end">
					<Button
						variant="outline"
						onClick={() => handleCopy(instructions.newRepo, "new")}
					>
						{copiedSection === "new" ? "Copied" : "Copy commands"}
					</Button>
				</div>
			</Card>

			<Card className="p-5">
				<h2 className="text-base font-semibold tracking-tight text-foreground">
					Push an Existing Repository
				</h2>
				<pre className="mt-4 overflow-x-auto rounded-[13px] border border-border bg-muted p-4 shadow-[var(--bjork-shadow-inset)] text-xs text-foreground">
					<code>{instructions.existingRepo}</code>
				</pre>
				<div className="mt-4 flex justify-end">
					<Button
						variant="outline"
						onClick={() => handleCopy(instructions.existingRepo, "existing")}
					>
						{copiedSection === "existing" ? "Copied" : "Copy commands"}
					</Button>
				</div>
			</Card>
		</div>
	);
}
