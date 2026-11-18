import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { DetailHeader } from "@/components/DetailHeader";
import { DiscussionMenu } from "@/components/discussions/DiscussionMenu";
import { DiscussionThread } from "@/components/discussions/DiscussionThread";
import { NotFoundCard } from "@/components/NotFoundCard";
import { contentQuery } from "@/lib/prefetch";
import {
	discussionByNumberQueryOptions,
	discussionCommentsQueryOptions,
	issueByNumberQueryOptions,
	repositoryByNameQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
} from "@/lib/query-options";
import { ensureThreadNumberRedirect } from "@/lib/thread-number-redirect";

export const Route = createFileRoute("/$owner/$name/discussions/$id")({
	loader: async ({ params, context: { queryClient } }) => {
		const number = Number(params.id);
		if (!Number.isInteger(number) || number < 1) throw notFound();
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo?.hasDiscussions) throw notFound();
		const discussion = await queryClient
			.ensureQueryData(
				discussionByNumberQueryOptions({
					owner: params.owner,
					name: params.name,
					number,
				}),
			)
			.catch((error: unknown) =>
				ensureThreadNumberRedirect(error, params, [
					{
						route: "/$owner/$name/issues/$id",
						find: () =>
							queryClient.ensureQueryData(
								issueByNumberQueryOptions({
									owner: params.owner,
									name: params.name,
									number,
								}),
							),
					},
				]),
			);
		await Promise.all([
			queryClient
				.ensureInfiniteQueryData(
					discussionCommentsQueryOptions(discussion.discussion.id),
				)
				.catch(() => {}),
			contentQuery(queryClient, repositoryIssueNumbersQueryOptions(repo.id)),
			contentQuery(
				queryClient,
				repositoryPullRequestNumbersQueryOptions(repo.id),
			),
		]);
		return discussion;
	},
	component: DiscussionPage,
	notFoundComponent: DiscussionNotFound,
});

function DiscussionPage() {
	const { owner, name, id } = Route.useParams();
	const initial = Route.useLoaderData();
	const { data } = useQuery({
		...discussionByNumberQueryOptions({
			owner,
			name,
			number: Number(id),
		}),
		initialData: initial,
	});
	const discussion = data.discussion;

	return (
		<div>
			<DetailHeader
				title={discussion.title}
				number={discussion.number}
				badge={
					discussion.isAnswered ? (
						<span className="text-xs font-medium text-bjork-accent">
							Answered
						</span>
					) : undefined
				}
				meta={
					<p>
						<span className="font-medium text-bjork-text">
							{discussion.author.name}
						</span>{" "}
						started this discussion
					</p>
				}
				actions={
					data.viewer.canWrite ? (
						<DiscussionMenu owner={owner} name={name} discussion={discussion} />
					) : undefined
				}
			/>
			<DiscussionThread
				owner={owner}
				name={name}
				discussion={discussion}
				canParticipate={data.viewer.canParticipate}
				canWrite={data.viewer.canWrite}
			/>
		</div>
	);
}

function DiscussionNotFound() {
	const { owner, name } = Route.useParams();
	return (
		<NotFoundCard
			title="Discussion Not Found"
			backTo="/$owner/$name/discussions"
			backParams={{ owner, name }}
			backLabel="Back to Discussions"
		/>
	);
}
