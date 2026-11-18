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
			organization: r.one.organizations({
				from: r.repositories.organizationId,
				to: r.organizations.id,
			}),
			issues: r.many.issues({
				from: r.repositories.id,
				to: r.issues.repoId,
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
		teams: {
			organization: r.one.organizations({
				from: r.teams.orgId,
				to: r.organizations.id,
				optional: false,
			}),
			parent: r.one.teams({
				from: r.teams.parentTeamId,
				to: r.teams.id,
			}),
			memberships: r.many.teamMemberships({
				from: r.teams.id,
				to: r.teamMemberships.teamId,
			}),
			repositories: r.many.teamRepositories({
				from: r.teams.id,
				to: r.teamRepositories.teamId,
			}),
		},
		teamMemberships: {
			team: r.one.teams({
				from: r.teamMemberships.teamId,
				to: r.teams.id,
				optional: false,
			}),
			user: r.one.user({
				from: r.teamMemberships.userId,
				to: r.user.id,
				optional: false,
			}),
		},
		teamRepositories: {
			team: r.one.teams({
				from: r.teamRepositories.teamId,
				to: r.teams.id,
				optional: false,
			}),
			repository: r.one.repositories({
				from: r.teamRepositories.repoId,
				to: r.repositories.id,
				optional: false,
			}),
		},
		organizations: {
			repositories: r.many.repositories({
				from: r.organizations.id,
				to: r.repositories.organizationId,
			}),
			memberships: r.many.orgMemberships({
				from: r.organizations.id,
				to: r.orgMemberships.orgId,
			}),
			teams: r.many.teams({
				from: r.organizations.id,
				to: r.teams.orgId,
			}),
		},
		orgMemberships: {
			organization: r.one.organizations({
				from: r.orgMemberships.orgId,
				to: r.organizations.id,
				optional: false,
			}),
			user: r.one.user({
				from: r.orgMemberships.userId,
				to: r.user.id,
				optional: false,
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
			pullRequest: r.one.pullRequests({
				from: r.issues.id,
				to: r.pullRequests.issueId,
			}),
			comments: r.many.comments({
				from: r.issues.id,
				to: r.comments.issueId,
			}),
			assignees: r.many.threadAssignees({
				from: r.issues.id,
				to: r.threadAssignees.issueId,
			}),
		},
		threadAssignees: {
			user: r.one.user({
				from: r.threadAssignees.userId,
				to: r.user.id,
				optional: false,
			}),
		},
		pullRequestReviewRequests: {
			user: r.one.user({
				from: r.pullRequestReviewRequests.userId,
				to: r.user.id,
				optional: false,
			}),
		},
		pullRequests: {
			issue: r.one.issues({
				from: r.pullRequests.issueId,
				to: r.issues.id,
				optional: false,
			}),
			reviews: r.many.pullRequestReviews({
				from: r.pullRequests.issueId,
				to: r.pullRequestReviews.pullRequestId,
			}),
			reviewComments: r.many.pullRequestReviewComments({
				from: r.pullRequests.issueId,
				to: r.pullRequestReviewComments.pullRequestId,
			}),
		},
		pullRequestReviews: {
			pullRequest: r.one.pullRequests({
				from: r.pullRequestReviews.pullRequestId,
				to: r.pullRequests.issueId,
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
				to: r.pullRequests.issueId,
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
				optional: false,
			}),
			author: r.one.user({
				from: r.comments.authorId,
				to: r.user.id,
				optional: false,
			}),
		},
		releases: {
			repository: r.one.repositories({
				from: r.releases.repoId,
				to: r.repositories.id,
				optional: false,
			}),
			author: r.one.user({
				from: r.releases.authorId,
				to: r.user.id,
				optional: false,
			}),
			assets: r.many.releaseAssets({
				from: r.releases.id,
				to: r.releaseAssets.releaseId,
			}),
		},
		releaseAssets: {
			release: r.one.releases({
				from: r.releaseAssets.releaseId,
				to: r.releases.id,
				optional: false,
			}),
			uploader: r.one.user({
				from: r.releaseAssets.uploaderId,
				to: r.user.id,
				optional: false,
			}),
		},
		commitComments: {
			repository: r.one.repositories({
				from: r.commitComments.repoId,
				to: r.repositories.id,
				optional: false,
			}),
			author: r.one.user({
				from: r.commitComments.authorId,
				to: r.user.id,
				optional: false,
			}),
		},
		commitStatuses: {
			creator: r.one.user({
				from: r.commitStatuses.creatorId,
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
		gists: {
			owner: r.one.user({
				from: r.gists.ownerId,
				to: r.user.id,
				optional: false,
			}),
			forkOf: r.one.gists({
				from: r.gists.forkOfId,
				to: r.gists.id,
			}),
			stars: r.many.gistStars({
				from: r.gists.id,
				to: r.gistStars.gistId,
			}),
			comments: r.many.gistComments({
				from: r.gists.id,
				to: r.gistComments.gistId,
			}),
		},
		gistStars: {
			gist: r.one.gists({
				from: r.gistStars.gistId,
				to: r.gists.id,
				optional: false,
			}),
			user: r.one.user({
				from: r.gistStars.userId,
				to: r.user.id,
				optional: false,
			}),
		},
		gistComments: {
			gist: r.one.gists({
				from: r.gistComments.gistId,
				to: r.gists.id,
				optional: false,
			}),
			author: r.one.user({
				from: r.gistComments.userId,
				to: r.user.id,
				optional: false,
			}),
		},
		projectV2: {
			owner: r.one.user({
				from: r.projectV2.ownerId,
				to: r.user.id,
				optional: false,
			}),
			fields: r.many.projectV2Fields({
				from: r.projectV2.id,
				to: r.projectV2Fields.projectId,
			}),
			items: r.many.projectV2Items({
				from: r.projectV2.id,
				to: r.projectV2Items.projectId,
			}),
		},
		projectV2Fields: {
			project: r.one.projectV2({
				from: r.projectV2Fields.projectId,
				to: r.projectV2.id,
				optional: false,
			}),
			options: r.many.projectV2SingleSelectOptions({
				from: r.projectV2Fields.id,
				to: r.projectV2SingleSelectOptions.fieldId,
			}),
		},
		projectV2SingleSelectOptions: {
			field: r.one.projectV2Fields({
				from: r.projectV2SingleSelectOptions.fieldId,
				to: r.projectV2Fields.id,
				optional: false,
			}),
		},
		projectV2Items: {
			project: r.one.projectV2({
				from: r.projectV2Items.projectId,
				to: r.projectV2.id,
				optional: false,
			}),
			issue: r.one.issues({
				from: r.projectV2Items.issueId,
				to: r.issues.id,
			}),
			fieldValues: r.many.projectV2ItemFieldValues({
				from: r.projectV2Items.id,
				to: r.projectV2ItemFieldValues.itemId,
			}),
		},
		projectV2ItemFieldValues: {
			item: r.one.projectV2Items({
				from: r.projectV2ItemFieldValues.itemId,
				to: r.projectV2Items.id,
				optional: false,
			}),
			field: r.one.projectV2Fields({
				from: r.projectV2ItemFieldValues.fieldId,
				to: r.projectV2Fields.id,
				optional: false,
			}),
		},
	}),
);
