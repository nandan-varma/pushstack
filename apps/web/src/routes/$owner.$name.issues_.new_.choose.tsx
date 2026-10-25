import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { isSafeHref } from "@/components/MarkdownRenderer";
import { PageHeader } from "@/components/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import {
	repositoryByNameQueryOptions,
	repositoryTemplatesQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/issues_/new_/choose")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions(params),
		);
		if (!repo) return;
		const templates = await queryClient.ensureQueryData(
			repositoryTemplatesQueryOptions(repo.id),
		);
		if (
			!templates.issueTemplates.length &&
			!templates.contactLinks.length &&
			templates.blankIssuesEnabled
		)
			throw redirect({ to: "/$owner/$name/issues/new", params });
	},
	component: TemplateChooser,
});

function TemplateChooser() {
	const { owner, name } = Route.useParams();
	const { data: repo } = useSuspenseQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	if (!repo) return null;
	return (
		<Chooser
			repoId={repo.id}
			owner={owner}
			name={name}
			canWrite={repo.viewer.canWrite}
		/>
	);
}
function Chooser({
	repoId,
	owner,
	name,
	canWrite,
}: {
	repoId: number;
	owner: string;
	name: string;
	canWrite: boolean;
}) {
	const { data } = useSuspenseQuery(repositoryTemplatesQueryOptions(repoId));
	return (
		<div className="space-y-5">
			<PageHeader
				title="New issue"
				description="Choose a template to get started."
			/>
			<div className="divide-y divide-bjork-border-muted rounded-xl border border-bjork-border-muted">
				{data.issueTemplates.map((template) => (
					<div
						key={template.filename}
						className="flex flex-wrap items-center justify-between gap-4 p-4"
					>
						<div>
							<h2 className="font-medium">{template.name}</h2>
							<p className="text-sm text-bjork-text-muted">
								{template.description}
							</p>
						</div>
						<Link
							to="/$owner/$name/issues/new"
							params={{ owner, name }}
							search={{ template: template.filename }}
							className={buttonVariants({ variant: "outline" })}
						>
							Get started
						</Link>
					</div>
				))}
				{data.contactLinks.map((link) => (
					<div
						key={link.url}
						className="flex flex-wrap items-center justify-between gap-4 p-4"
					>
						<div>
							<h2 className="font-medium">{link.name}</h2>
							<p className="text-sm text-bjork-text-muted">{link.about}</p>
						</div>
						<a
							href={isSafeHref(link.url) ? link.url : undefined}
							className={buttonVariants({ variant: "outline" })}
						>
							Open
						</a>
					</div>
				))}
			</div>
			{(data.blankIssuesEnabled || canWrite) && (
				<Link
					to="/$owner/$name/issues/new"
					params={{ owner, name }}
					className={buttonVariants({ variant: "outline" })}
				>
					Open a blank issue
					{!data.blankIssuesEnabled ? " (maintainers only)" : ""}
				</Link>
			)}
		</div>
	);
}
