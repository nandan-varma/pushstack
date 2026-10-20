import { defineRelations } from "drizzle-orm";
import * as appSchema from "./app-schema";
import * as authSchema from "./schema";

export const relations = defineRelations(
	{ ...authSchema, ...appSchema },
	(r) => ({
		repositories: {
			owner: r.one.user({
				from: r.repositories.ownerId,
				to: r.user.id,
				optional: false,
			}),
			issues: r.many.issues({
				from: r.repositories.id,
				to: r.issues.repoId,
			}),
			pullRequests: r.many.pullRequests({
				from: r.repositories.id,
				to: r.pullRequests.repoId,
			}),
			stars: r.many.stars({
				from: r.repositories.id,
				to: r.stars.repoId,
			}),
			collaborators: r.many.repositoryCollaborators({
				from: r.repositories.id,
				to: r.repositoryCollaborators.repoId,
			}),
			activities: r.many.activities({
				from: r.repositories.id,
				to: r.activities.repoId,
			}),
		},
		issues: {
			repository: r.one.repositories({
				from: r.issues.repoId,
				to: r.repositories.id,
				optional: false,
			}),
			author: r.one.user({
				from: r.issues.authorId,
				to: r.user.id,
				optional: false,
			}),
			comments: r.many.comments({
				from: r.issues.id,
				to: r.comments.issueId,
			}),
			assignees: r.many.issueAssignees({
				from: r.issues.id,
				to: r.issueAssignees.issueId,
			}),
		},
		issueAssignees: {
			issue: r.one.issues({
				from: r.issueAssignees.issueId,
				to: r.issues.id,
				optional: false,
			}),
			user: r.one.user({
				from: r.issueAssignees.userId,
				to: r.user.id,
				optional: false,
			}),
		},
		pullRequests: {
			repository: r.one.repositories({
				from: r.pullRequests.repoId,
				to: r.repositories.id,
				optional: false,
			}),
			author: r.one.user({
				from: r.pullRequests.authorId,
				to: r.user.id,
				optional: false,
			}),
			comments: r.many.comments({
				from: r.pullRequests.id,
				to: r.comments.pullRequestId,
			}),
			reviews: r.many.pullRequestReviews({
				from: r.pullRequests.id,
				to: r.pullRequestReviews.pullRequestId,
			}),
			reviewComments: r.many.pullRequestReviewComments({
				from: r.pullRequests.id,
				to: r.pullRequestReviewComments.pullRequestId,
			}),
		},
		pullRequestReviews: {
			pullRequest: r.one.pullRequests({
				from: r.pullRequestReviews.pullRequestId,
				to: r.pullRequests.id,
				optional: false,
			}),
			author: r.one.user({
				from: r.pullRequestReviews.authorId,
				to: r.user.id,
				optional: false,
			}),
			comments: r.many.pullRequestReviewComments({
				from: r.pullRequestReviews.id,
				to: r.pullRequestReviewComments.reviewId,
			}),
		},
		pullRequestReviewComments: {
			pullRequest: r.one.pullRequests({
				from: r.pullRequestReviewComments.pullRequestId,
				to: r.pullRequests.id,
				optional: false,
			}),
			review: r.one.pullRequestReviews({
				from: r.pullRequestReviewComments.reviewId,
				to: r.pullRequestReviews.id,
				optional: false,
			}),
			author: r.one.user({
				from: r.pullRequestReviewComments.authorId,
				to: r.user.id,
				optional: false,
			}),
		},
		comments: {
			repository: r.one.repositories({
				from: r.comments.repoId,
				to: r.repositories.id,
				optional: false,
			}),
			issue: r.one.issues({
				from: r.comments.issueId,
				to: r.issues.id,
			}),
			pullRequest: r.one.pullRequests({
				from: r.comments.pullRequestId,
				to: r.pullRequests.id,
			}),
			author: r.one.user({
				from: r.comments.authorId,
				to: r.user.id,
				optional: false,
			}),
		},
		stars: {
			repository: r.one.repositories({
				from: r.stars.repoId,
				to: r.repositories.id,
				optional: false,
			}),
			user: r.one.user({
				from: r.stars.userId,
				to: r.user.id,
				optional: false,
			}),
		},
		repositoryCollaborators: {
			repository: r.one.repositories({
				from: r.repositoryCollaborators.repoId,
				to: r.repositories.id,
				optional: false,
			}),
			user: r.one.user({
				from: r.repositoryCollaborators.userId,
				to: r.user.id,
				optional: false,
			}),
		},
		timelineEvents: {
			actor: r.one.user({
				from: r.timelineEvents.actorId,
				to: r.user.id,
				optional: false,
			}),
		},
		activities: {
			user: r.one.user({
				from: r.activities.userId,
				to: r.user.id,
				optional: false,
			}),
			repository: r.one.repositories({
				from: r.activities.repoId,
				to: r.repositories.id,
			}),
		},
		tokens: {
			user: r.one.user({
				from: r.tokens.userId,
				to: r.user.id,
				optional: false,
			}),
		},
	}),
);
