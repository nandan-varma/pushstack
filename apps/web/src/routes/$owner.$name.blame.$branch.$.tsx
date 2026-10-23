import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileCode } from "lucide-react";
import { Toolbar } from "@/components/layout/page";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import { BlameView } from "@/components/repo/BlameView";
import { RepoResourceNotFound } from "@/components/repo/RepoResourceNotFound";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { contentQuery } from "@/lib/prefetch";
import {
	repositoryBlameQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/blame/$branch/$")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			// Blame walks history: shown content, but never holds up navigation
			// in the browser (the page renders its own loading state).
			await contentQuery(
				queryClient,
				repositoryBlameQueryOptions({
					repoId: repo.id,
					branchName: params.branch,
					path: params._splat || "",
				}),
			);
		}
	},
	component: BlamePage,
	notFoundComponent: () => (
		<RepoResourceNotFound
			title="File not found"
			message="This branch or file doesn't exist."
		/>
	),
});

function BlamePage() {
	const { owner, name, branch, _splat } = Route.useParams();
	const filePath = _splat || "";

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data, isLoading, error } = useQuery({
		...repositoryBlameQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: branch,
			path: filePath,
		}),
		enabled: !!repo,
	});

	const header = (
		<Toolbar>
			<PathBreadcrumb
				owner={owner}
				name={name}
				branch={branch}
				filePath={filePath}
				asHeading
			/>
			<Link
				to="/$owner/$name/blob/$branch/$"
				params={{ owner, name, branch, _splat: filePath }}
				className={buttonVariants({ variant: "outline", size: "sm" })}
			>
				<FileCode />
				Normal view
			</Link>
		</Toolbar>
	);

	if (isLoading || !repo) {
		return (
			<div className="space-y-4">
				{header}
				<Skeleton className="h-96" role="status" aria-label="Loading blame" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<NotFoundCard
				title="File Not Found"
				message={`The file "${filePath}" does not exist in the ${branch} branch.`}
				backTo="/$owner/$name/tree/$branch/$"
				backParams={{ owner, name, branch, _splat: "" }}
				backLabel="Back to Files"
			/>
		);
	}

	return (
		<div className="space-y-4">
			{header}
			<BlameView owner={owner} name={name} filePath={filePath} blame={data} />
		</div>
	);
}
