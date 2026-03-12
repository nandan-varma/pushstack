import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCloneUrl, getSetupInstructions } from "@/lib/git-utils";
import {
	authSessionQueryOptions,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/repo/$owner/$name/setup")({
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
				<div className="h-36 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--card-bg)]" />
				<div className="h-48 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--card-bg)]" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<Card className="p-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-2xl font-semibold text-[var(--sea-ink)]">
							Repository Setup
						</h2>
						<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
							Git, R2-backed object storage, and SQL metadata are configured for
							this repository.
						</p>
					</div>
					<Link to="/repo/$owner/$name" params={{ owner, name }}>
						<Button variant="outline">Back to Code</Button>
					</Link>
				</div>
			</Card>

			<Card className="p-6">
				<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
					Clone URL
				</h3>
				<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
					Use this remote for clone, fetch, pull, and push.
				</p>
				<div className="mt-4 flex flex-wrap gap-2">
					<input
						readOnly
						value={cloneUrl}
						className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm"
					/>
					<Button variant="outline" onClick={() => handleCopy(cloneUrl, "url")}>
						{copiedSection === "url" ? "Copied" : "Copy"}
					</Button>
				</div>
			</Card>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card className="p-6">
					<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
						Repository Status
					</h3>
					<dl className="mt-4 space-y-3 text-sm">
						<div className="flex items-center justify-between gap-4">
							<dt className="text-[var(--sea-ink-soft)]">Visibility</dt>
							<dd className="font-medium text-[var(--sea-ink)]">
								{repo.visibility}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-[var(--sea-ink-soft)]">Default branch</dt>
							<dd className="font-medium text-[var(--sea-ink)]">
								{defaultBranch}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-[var(--sea-ink-soft)]">Branches</dt>
							<dd className="font-medium text-[var(--sea-ink)]">
								{branches?.length || 0}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-[var(--sea-ink-soft)]">Storage</dt>
							<dd className="font-medium text-[var(--sea-ink)]">
								Git objects in R2
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-[var(--sea-ink-soft)]">Metadata</dt>
							<dd className="font-medium text-[var(--sea-ink)]">SQL-backed</dd>
						</div>
					</dl>
				</Card>

				<Card className="p-6">
					<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
						Next Actions
					</h3>
					<div className="mt-4 flex flex-col gap-3">
						<Link
							to="/repo/$owner/$name/commits"
							params={{ owner, name }}
							search={{ branch: defaultBranch }}
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
				<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
					Push a New Repository
				</h3>
				<pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-4 text-xs text-[var(--sea-ink)]">
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
				<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
					Push an Existing Repository
				</h3>
				<pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-4 text-xs text-[var(--sea-ink)]">
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
