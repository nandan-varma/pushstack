import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { IssueFormFields } from "@/components/thread-list/IssueFormFields";
import { SignInButton } from "@/components/thread-list/ThreadList";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";
import {
	commaSeparated,
	issueFormBody,
	issueTemplatePrefill,
} from "@/lib/issue-template-form";
import { MAX_BODY_CHARS, MAX_THREAD_TITLE_CHARS } from "@/lib/limits";
import {
	assignableUsersQueryOptions,
	authSessionQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryLabelsQueryOptions,
	repositoryTemplatesQueryOptions,
} from "@/lib/query-options";
import type { IssueTemplate } from "@/lib/repository-templates";
import { createIssue } from "@/server/issues";

interface NewIssueSearch {
	template?: string;
	title?: string;
	body?: string;
	labels?: string;
	assignees?: string;
}

export const Route = createFileRoute("/$owner/$name/issues_/new")({
	validateSearch: (search: Record<string, unknown>): NewIssueSearch => ({
		template: typeof search.template === "string" ? search.template : undefined,
		title: typeof search.title === "string" ? search.title : undefined,
		body: typeof search.body === "string" ? search.body : undefined,
		labels: typeof search.labels === "string" ? search.labels : undefined,
		assignees:
			typeof search.assignees === "string" ? search.assignees : undefined,
	}),
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions(params),
		);
		if (repo)
			await queryClient.ensureQueryData(
				repositoryTemplatesQueryOptions(repo.id),
			);
	},
	component: NewIssuePage,
});
function NewIssuePage() {
	const { owner, name } = Route.useParams();
	const search = Route.useSearch();
	const { data: repo } = useSuspenseQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	if (!repo) return null;
	return <NewIssue repo={repo} search={search} key={JSON.stringify(search)} />;
}
function NewIssue({
	repo,
	search,
}: {
	repo: { id: number; viewer: { canWrite: boolean } };
	search: ReturnType<typeof Route.useSearch>;
}) {
	const { owner, name } = Route.useParams();
	const { data: templates } = useSuspenseQuery(
		repositoryTemplatesQueryOptions(repo.id),
	);
	const { data: session } = useSuspenseQuery(authSessionQueryOptions());
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: createIssue,
		onSuccess: async (issue) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoIssuesRoot(repo.id),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.repositoryByName(owner, name),
				}),
			]);
			navigate({
				to: "/$owner/$name/issues/$id",
				params: { owner, name, id: String(issue.number) },
			});
		},
	});
	const template: IssueTemplate | undefined = templates.issueTemplates.find(
		(t) => t.filename === search.template,
	);
	const { data: labels } = useSuspenseQuery(
		repositoryLabelsQueryOptions(repo.id),
	);
	const { data: assignable } = useSuspenseQuery(
		assignableUsersQueryOptions(repo.id),
	);
	const prefill = issueTemplatePrefill(template, search, {
		labels: labels.labels.map((label) => label.name),
		assignees: assignable.map((person) => person.username),
	});
	if (search.template && !template)
		return <ErrorAlert message="Issue template not found." />;
	const form = search.body === undefined ? template?.form : null;
	return (
		<div className="mx-auto max-w-3xl space-y-5">
			<PageHeader
				title={template?.name ?? "New issue"}
				description={template?.description}
			/>
			{!session?.user ? (
				<SignInButton>Sign in to create an issue</SignInButton>
			) : (
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						const data = new FormData(event.currentTarget);
						mutation.mutate({
							data: {
								repoId: repo.id,
								template: template?.filename,
								title: String(data.get("title")),
								body: form
									? issueFormBody(form, data)
									: String(data.get("body") ?? ""),
								labels: commaSeparated(
									String(data.get("labels") ?? prefill.labels),
								),
								assignees: commaSeparated(
									String(data.get("assignees") ?? prefill.assignees),
								),
							},
						});
					}}
				>
					<div className="space-y-1.5">
						<Label htmlFor="issue-title">Title (required)</Label>
						<Input
							id="issue-title"
							name="title"
							required
							maxLength={MAX_THREAD_TITLE_CHARS}
							defaultValue={prefill.title}
						/>
					</div>
					{form ? (
						<IssueFormFields elements={form} />
					) : (
						<div className="space-y-1.5">
							<Label htmlFor="issue-body">Description</Label>
							<Textarea
								id="issue-body"
								name="body"
								rows={12}
								maxLength={MAX_BODY_CHARS}
								defaultValue={prefill.body}
							/>
						</div>
					)}
					{repo.viewer.canWrite && (
						<>
							<div className="space-y-1.5">
								<Label htmlFor="issue-labels">Labels</Label>
								<Input
									id="issue-labels"
									name="labels"
									defaultValue={prefill.labels}
								/>
								<p className="text-sm text-bjork-text-muted">
									Separate label names with commas.
								</p>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="issue-assignees">Assignees</Label>
								<Input
									id="issue-assignees"
									name="assignees"
									defaultValue={prefill.assignees}
								/>
								<p className="text-sm text-bjork-text-muted">
									Separate usernames with commas.
								</p>
							</div>
						</>
					)}
					{mutation.error && <ErrorAlert message={mutation.error.message} />}
					<LoadingButton
						type="submit"
						isLoading={mutation.isPending}
						loadingLabel="Creating…"
					>
						Create issue
					</LoadingButton>
				</form>
			)}
			<Link
				to="/$owner/$name/issues/new/choose"
				params={{ owner, name }}
				className="text-sm text-bjork-accent hover:underline"
			>
				Choose another template
			</Link>
		</div>
	);
}
