import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { UserNode } from './core';
import type { RepositoryNode, RefNode } from './repository';
import type { CommitNode, GitSignatureNode } from './commit';
import type { IssueNode } from './issues';
import type { PullRequestNode } from './pulls';
import type { ReviewNode, CommentNode, RollupNode } from './pulls-detail';
import type { ReleaseNode, ReleaseAssetNode } from './releases';
import type { IssueTemplateNode } from './templates';
import type { RateLimitInfo, GraphQLContext } from '../context';
import type { ProjectNode, ProjectItemNode, ProjectFieldNode, DraftIssueNode, ProjectFieldValueNode } from './projects';
import type { GistNode, GistFileNode, GistCommentNode, LanguageNode } from './gists';
import type { DiscussionNode, DiscussionCommentNode, DiscussionCategoryNode } from './discussions';
import type { OrganizationNode, TeamNode, TeamMemberEdgeNode, TeamRepositoryEdgeNode } from './organizations';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** An ISO-8601 encoded UTC date string. */
  DateTime: { input: string; output: string; }
  /** An RFC 3986, RFC 3987, and RFC 6570 (level 4) compliant URI string. */
  URI: { input: string; output: string; }
  /** A Git object ID. */
  GitObjectID: { input: string; output: string; }
  /** Git SSH string */
  GitSSHRemote: { input: string; output: string; }
  /** An ISO-8601 encoded date string. Unlike the DateTime type, GitTimestamp is not converted in UTC. */
  GitTimestamp: { input: unknown; output: unknown; }
  /** An ISO-8601 encoded date string. */
  Date: { input: unknown; output: unknown; }
};

/** The query root of GitHub's GraphQL interface. */
export type Query = {
  __typename?: 'Query';
  /** The currently authenticated user. */
  viewer: User;
  /** Fetches an object given its ID. */
  node?: Maybe<Node>;
  /** Lookup nodes by a list of IDs. */
  nodes: Array<Maybe<Node>>;
  /** The client's rate limit information. */
  rateLimit?: Maybe<RateLimit>;
  /** Lookup a given repository by the owner and repository name. */
  repository?: Maybe<Repository>;
  /** Lookup a repository owner (ie. either a User or an Organization) by login. */
  repositoryOwner?: Maybe<RepositoryOwner>;
  /** Lookup a user by login. */
  user?: Maybe<User>;
  /** Lookup a organization by login. */
  organization?: Maybe<Organization>;
  /** Perform a search across resources, returning a maximum of 1,000 results. */
  search: SearchResultItemConnection;
  /** Lookup resource by a URL. */
  resource?: Maybe<UniformResourceLocatable>;
};


/** The query root of GitHub's GraphQL interface. */
export type QueryNodeArgs = {
  id: Scalars['ID']['input'];
};


/** The query root of GitHub's GraphQL interface. */
export type QueryNodesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


/** The query root of GitHub's GraphQL interface. */
export type QueryRepositoryArgs = {
  name: Scalars['String']['input'];
  owner: Scalars['String']['input'];
};


/** The query root of GitHub's GraphQL interface. */
export type QueryRepositoryOwnerArgs = {
  login: Scalars['String']['input'];
};


/** The query root of GitHub's GraphQL interface. */
export type QueryUserArgs = {
  login: Scalars['String']['input'];
};


/** The query root of GitHub's GraphQL interface. */
export type QueryOrganizationArgs = {
  login: Scalars['String']['input'];
};


/** The query root of GitHub's GraphQL interface. */
export type QuerySearchArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
  type: SearchType;
};


/** The query root of GitHub's GraphQL interface. */
export type QueryResourceArgs = {
  url: Scalars['URI']['input'];
};

/** An object with an ID. */
export type Node = {
  /** ID of the object. */
  id: Scalars['ID']['output'];
};

/** Information about pagination in a connection. */
export type PageInfo = {
  __typename?: 'PageInfo';
  /** When paginating forwards, the cursor to continue. */
  endCursor?: Maybe<Scalars['String']['output']>;
  /** When paginating forwards, are there more items? */
  hasNextPage: Scalars['Boolean']['output'];
  /** When paginating backwards, are there more items? */
  hasPreviousPage: Scalars['Boolean']['output'];
  /** When paginating backwards, the cursor to continue. */
  startCursor?: Maybe<Scalars['String']['output']>;
};

/** Represents the client's rate limit. */
export type RateLimit = {
  __typename?: 'RateLimit';
  /** The point cost for the current query counting against the rate limit. */
  cost: Scalars['Int']['output'];
  /** The maximum number of points the client is permitted to consume in a 60 minute window. */
  limit: Scalars['Int']['output'];
  /** The maximum number of nodes this query may return */
  nodeCount: Scalars['Int']['output'];
  /** The number of points remaining in the current rate limit window. */
  remaining: Scalars['Int']['output'];
  /** The time at which the current rate limit window resets in UTC epoch seconds. */
  resetAt: Scalars['DateTime']['output'];
  /** The number of points used in the current rate limit window. */
  used: Scalars['Int']['output'];
};

/** Represents a type that can be retrieved by a URL. */
export type UniformResourceLocatable = {
  /** The HTML path to this resource. */
  resourcePath: Scalars['URI']['output'];
  /** The URL to this resource. */
  url: Scalars['URI']['output'];
};

/** Represents an object which can take actions on GitHub. Typically a User or Bot. */
export type Actor = {
  /** The username of the actor. */
  login: Scalars['String']['output'];
  /** The HTTP path for this actor. */
  resourcePath: Scalars['URI']['output'];
  /** The HTTP URL for this actor. */
  url: Scalars['URI']['output'];
};

/** A user is an individual's account on GitHub that owns repositories and can make new content. */
export type User = Actor & Node & RepositoryOwner & UniformResourceLocatable & ProjectV2Owner & {
  __typename?: 'User';
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The Node ID of the User object */
  id: Scalars['ID']['output'];
  /** The username used to login. */
  login: Scalars['String']['output'];
  /** The user's public profile name. */
  name?: Maybe<Scalars['String']['output']>;
  /** The HTTP path for this user */
  resourcePath: Scalars['URI']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** The HTTP URL for this user */
  url: Scalars['URI']['output'];
  /** A list of repositories that the user owns. */
  repositories: RepositoryConnection;
  /** Find Repository. */
  repository?: Maybe<Repository>;
  /** A list of projects under the owner. */
  projectsV2: ProjectV2Connection;
  /** Find a project by number. */
  projectV2?: Maybe<ProjectV2>;
  /** A list of the Gists the user has created. */
  gists: GistConnection;
};


/** A user is an individual's account on GitHub that owns repositories and can make new content. */
export type UserRepositoriesArgs = {
  affiliations?: InputMaybe<Array<InputMaybe<RepositoryAffiliation>>>;
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  isArchived?: InputMaybe<Scalars['Boolean']['input']>;
  isFork?: InputMaybe<Scalars['Boolean']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RepositoryOrder>;
  ownerAffiliations?: InputMaybe<Array<InputMaybe<RepositoryAffiliation>>>;
  privacy?: InputMaybe<RepositoryPrivacy>;
  visibility?: InputMaybe<RepositoryVisibility>;
};


/** A user is an individual's account on GitHub that owns repositories and can make new content. */
export type UserRepositoryArgs = {
  name: Scalars['String']['input'];
};


/** A user is an individual's account on GitHub that owns repositories and can make new content. */
export type UserProjectsV2Args = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  minPermissionLevel?: InputMaybe<ProjectV2PermissionLevel>;
  orderBy?: InputMaybe<ProjectV2Order>;
  query?: InputMaybe<Scalars['String']['input']>;
};


/** A user is an individual's account on GitHub that owns repositories and can make new content. */
export type UserProjectV2Args = {
  number: Scalars['Int']['input'];
};


/** A user is an individual's account on GitHub that owns repositories and can make new content. */
export type UserGistsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<GistOrder>;
  privacy?: InputMaybe<GistPrivacy>;
};

/** The root query for implementing GraphQL mutations. */
export type Mutation = {
  __typename?: 'Mutation';
  /** Create a new repository. */
  createRepository?: Maybe<CreateRepositoryPayload>;
  /** Update information about a repository. */
  updateRepository?: Maybe<UpdateRepositoryPayload>;
  /** Creates a new label. */
  createLabel?: Maybe<CreateLabelPayload>;
  /** Updates an existing label. */
  updateLabel?: Maybe<UpdateLabelPayload>;
  /** Deletes a label. */
  deleteLabel?: Maybe<DeleteLabelPayload>;
  /** Creates a new issue. */
  createIssue?: Maybe<CreateIssuePayload>;
  /** Updates an Issue. */
  updateIssue?: Maybe<UpdateIssuePayload>;
  /** Close an issue. */
  closeIssue?: Maybe<CloseIssuePayload>;
  /** Reopen a issue. */
  reopenIssue?: Maybe<ReopenIssuePayload>;
  /** Adds labels to a labelable object. */
  addLabelsToLabelable?: Maybe<AddLabelsToLabelablePayload>;
  /** Removes labels from a Labelable object. */
  removeLabelsFromLabelable?: Maybe<RemoveLabelsFromLabelablePayload>;
  /** Adds assignees to an assignable object. */
  addAssigneesToAssignable?: Maybe<AddAssigneesToAssignablePayload>;
  /** Removes assignees from an assignable object. */
  removeAssigneesFromAssignable?: Maybe<RemoveAssigneesFromAssignablePayload>;
  /** Adds a comment to an Issue or Pull Request. */
  addComment?: Maybe<AddCommentPayload>;
  /** Create a new pull request */
  createPullRequest?: Maybe<CreatePullRequestPayload>;
  /** Marks a pull request ready for review. */
  markPullRequestReadyForReview?: Maybe<MarkPullRequestReadyForReviewPayload>;
  /** Converts a pull request to draft */
  convertPullRequestToDraft?: Maybe<ConvertPullRequestToDraftPayload>;
  /** Close a pull request. */
  closePullRequest?: Maybe<ClosePullRequestPayload>;
  /** Reopen a pull request. */
  reopenPullRequest?: Maybe<ReopenPullRequestPayload>;
  /** Update a pull request */
  updatePullRequest?: Maybe<UpdatePullRequestPayload>;
  /**
   * Merge a pull request.
   *
   * > [!NOTE]
   * > We recommend using the [asynchronous merge REST
   * API](${externalDocsUrl}/rest/pulls/pulls#merge-a-pull-request-asynchronously) instead.
   * > This mutation does not support stacked pull requests.
   */
  mergePullRequest?: Maybe<MergePullRequestPayload>;
  /** Adds a review to a Pull Request. */
  addPullRequestReview?: Maybe<AddPullRequestReviewPayload>;
  /** Creates a new project. */
  createProjectV2?: Maybe<CreateProjectV2Payload>;
  /** Links an existing content instance to a Project. */
  addProjectV2ItemById?: Maybe<AddProjectV2ItemByIdPayload>;
  /** Creates a new draft issue and add it to a Project. */
  addProjectV2DraftIssue?: Maybe<AddProjectV2DraftIssuePayload>;
  /** Updates a draft issue within a Project. */
  updateProjectV2DraftIssue?: Maybe<UpdateProjectV2DraftIssuePayload>;
  /**
   * This mutation updates the value of a field for an item in a Project. Currently
   * only single-select, multi-select, text, number, date, and iteration fields are supported.
   */
  updateProjectV2ItemFieldValue?: Maybe<UpdateProjectV2ItemFieldValuePayload>;
  /**
   * This mutation clears the value of a field for an item in a Project. Currently
   * only text, number, date, assignees, labels, single-select, multi-select,
   * iteration and milestone fields are supported.
   */
  clearProjectV2ItemFieldValue?: Maybe<ClearProjectV2ItemFieldValuePayload>;
  /** Create a new project field. */
  createProjectV2Field?: Maybe<CreateProjectV2FieldPayload>;
  /** Create a discussion. */
  createDiscussion?: Maybe<CreateDiscussionPayload>;
  /** Adds a comment to a Discussion, possibly as a reply to another comment. */
  addDiscussionComment?: Maybe<AddDiscussionCommentPayload>;
  /** Mark a discussion comment as the chosen answer for discussions in an answerable category. */
  markDiscussionCommentAsAnswer?: Maybe<MarkDiscussionCommentAsAnswerPayload>;
  /** Unmark a discussion comment as the chosen answer for discussions in an answerable category. */
  unmarkDiscussionCommentAsAnswer?: Maybe<UnmarkDiscussionCommentAsAnswerPayload>;
  /** Add an upvote to a discussion or discussion comment. */
  addUpvote?: Maybe<AddUpvotePayload>;
  /** Remove an upvote to a discussion or discussion comment. */
  removeUpvote?: Maybe<RemoveUpvotePayload>;
  /** Close a discussion. */
  closeDiscussion?: Maybe<CloseDiscussionPayload>;
  /** Reopen a discussion. */
  reopenDiscussion?: Maybe<ReopenDiscussionPayload>;
  /** Update a discussion */
  updateDiscussion?: Maybe<UpdateDiscussionPayload>;
  /** Delete a discussion and all of its replies. */
  deleteDiscussion?: Maybe<DeleteDiscussionPayload>;
  /** Update the contents of a comment on a Discussion */
  updateDiscussionComment?: Maybe<UpdateDiscussionCommentPayload>;
  /** Delete a discussion comment. If it has replies, wipe it instead. */
  deleteDiscussionComment?: Maybe<DeleteDiscussionCommentPayload>;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreateRepositoryArgs = {
  input: CreateRepositoryInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUpdateRepositoryArgs = {
  input: UpdateRepositoryInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreateLabelArgs = {
  input: CreateLabelInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUpdateLabelArgs = {
  input: UpdateLabelInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationDeleteLabelArgs = {
  input: DeleteLabelInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreateIssueArgs = {
  input: CreateIssueInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUpdateIssueArgs = {
  input: UpdateIssueInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCloseIssueArgs = {
  input: CloseIssueInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationReopenIssueArgs = {
  input: ReopenIssueInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationAddLabelsToLabelableArgs = {
  input: AddLabelsToLabelableInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationRemoveLabelsFromLabelableArgs = {
  input: RemoveLabelsFromLabelableInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationAddAssigneesToAssignableArgs = {
  input: AddAssigneesToAssignableInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationRemoveAssigneesFromAssignableArgs = {
  input: RemoveAssigneesFromAssignableInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationAddCommentArgs = {
  input: AddCommentInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreatePullRequestArgs = {
  input: CreatePullRequestInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationMarkPullRequestReadyForReviewArgs = {
  input: MarkPullRequestReadyForReviewInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationConvertPullRequestToDraftArgs = {
  input: ConvertPullRequestToDraftInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationClosePullRequestArgs = {
  input: ClosePullRequestInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationReopenPullRequestArgs = {
  input: ReopenPullRequestInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUpdatePullRequestArgs = {
  input: UpdatePullRequestInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationMergePullRequestArgs = {
  input: MergePullRequestInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationAddPullRequestReviewArgs = {
  input: AddPullRequestReviewInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreateProjectV2Args = {
  input: CreateProjectV2Input;
};


/** The root query for implementing GraphQL mutations. */
export type MutationAddProjectV2ItemByIdArgs = {
  input: AddProjectV2ItemByIdInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationAddProjectV2DraftIssueArgs = {
  input: AddProjectV2DraftIssueInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUpdateProjectV2DraftIssueArgs = {
  input: UpdateProjectV2DraftIssueInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUpdateProjectV2ItemFieldValueArgs = {
  input: UpdateProjectV2ItemFieldValueInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationClearProjectV2ItemFieldValueArgs = {
  input: ClearProjectV2ItemFieldValueInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreateProjectV2FieldArgs = {
  input: CreateProjectV2FieldInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreateDiscussionArgs = {
  input: CreateDiscussionInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationAddDiscussionCommentArgs = {
  input: AddDiscussionCommentInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationMarkDiscussionCommentAsAnswerArgs = {
  input: MarkDiscussionCommentAsAnswerInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUnmarkDiscussionCommentAsAnswerArgs = {
  input: UnmarkDiscussionCommentAsAnswerInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationAddUpvoteArgs = {
  input: AddUpvoteInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationRemoveUpvoteArgs = {
  input: RemoveUpvoteInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationCloseDiscussionArgs = {
  input: CloseDiscussionInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationReopenDiscussionArgs = {
  input: ReopenDiscussionInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUpdateDiscussionArgs = {
  input: UpdateDiscussionInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationDeleteDiscussionArgs = {
  input: DeleteDiscussionInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationUpdateDiscussionCommentArgs = {
  input: UpdateDiscussionCommentInput;
};


/** The root query for implementing GraphQL mutations. */
export type MutationDeleteDiscussionCommentArgs = {
  input: DeleteDiscussionCommentInput;
};

/** Represents an owner of a Repository. */
export type RepositoryOwner = {
  /** The Node ID of the RepositoryOwner object */
  id: Scalars['ID']['output'];
  /** The username used to login. */
  login: Scalars['String']['output'];
  /** A list of repositories that the user owns. */
  repositories: RepositoryConnection;
  /** Find Repository. */
  repository?: Maybe<Repository>;
  /** The HTTP URL for the owner. */
  resourcePath: Scalars['URI']['output'];
  /** The HTTP URL for the owner. */
  url: Scalars['URI']['output'];
};


/** Represents an owner of a Repository. */
export type RepositoryOwnerRepositoriesArgs = {
  affiliations?: InputMaybe<Array<InputMaybe<RepositoryAffiliation>>>;
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  isArchived?: InputMaybe<Scalars['Boolean']['input']>;
  isFork?: InputMaybe<Scalars['Boolean']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RepositoryOrder>;
  ownerAffiliations?: InputMaybe<Array<InputMaybe<RepositoryAffiliation>>>;
  privacy?: InputMaybe<RepositoryPrivacy>;
  visibility?: InputMaybe<RepositoryVisibility>;
};


/** Represents an owner of a Repository. */
export type RepositoryOwnerRepositoryArgs = {
  name: Scalars['String']['input'];
};

/** A subset of repository info. */
export type RepositoryInfo = {
  /** Identifies the date and time when the repository was archived. */
  archivedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** The description of the repository. */
  description?: Maybe<Scalars['String']['output']>;
  /** Returns how many forks there are of this repository in the whole network. */
  forkCount: Scalars['Int']['output'];
  /** Indicates if the repository has the Discussions feature enabled. */
  hasDiscussionsEnabled: Scalars['Boolean']['output'];
  /** Indicates if the repository has issues feature enabled. */
  hasIssuesEnabled: Scalars['Boolean']['output'];
  /** Indicates if the repository has the Projects feature enabled. */
  hasProjectsEnabled: Scalars['Boolean']['output'];
  /** Indicates if the repository has wiki feature enabled. */
  hasWikiEnabled: Scalars['Boolean']['output'];
  /** The repository's URL. */
  homepageUrl?: Maybe<Scalars['URI']['output']>;
  /** Indicates if the repository is unmaintained. */
  isArchived: Scalars['Boolean']['output'];
  /** Identifies if the repository is a fork. */
  isFork: Scalars['Boolean']['output'];
  /** Indicates if a repository is either owned by an organization, or is a private fork of an organization repository. */
  isInOrganization: Scalars['Boolean']['output'];
  /** Indicates if the repository has been locked or not. */
  isLocked: Scalars['Boolean']['output'];
  /** Identifies if the repository is a mirror. */
  isMirror: Scalars['Boolean']['output'];
  /** Identifies if the repository is private or internal. */
  isPrivate: Scalars['Boolean']['output'];
  /** Identifies if the repository is a template that can be used to generate new repositories. */
  isTemplate: Scalars['Boolean']['output'];
  /** The repository's original mirror URL. */
  mirrorUrl?: Maybe<Scalars['URI']['output']>;
  /** The name of the repository. */
  name: Scalars['String']['output'];
  /** The repository's name with owner. */
  nameWithOwner: Scalars['String']['output'];
  /** The User owner of the repository. */
  owner: RepositoryOwner;
  /** Identifies the date and time when the repository was last pushed to. */
  pushedAt?: Maybe<Scalars['DateTime']['output']>;
  /** The HTTP path for this repository */
  resourcePath: Scalars['URI']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** The HTTP URL for this repository */
  url: Scalars['URI']['output'];
  /** Indicates the repository's visibility level. */
  visibility: RepositoryVisibility;
};

/** Things that can be starred. */
export type Starrable = {
  /** The Node ID of the Starrable object */
  id: Scalars['ID']['output'];
  /** Returns a count of how many stargazers there are on this object */
  stargazerCount: Scalars['Int']['output'];
  /** Returns a boolean indicating whether the viewing user has starred this starrable. */
  viewerHasStarred: Scalars['Boolean']['output'];
};

/** A repository contains the content for a project. */
export type Repository = Node & RepositoryInfo & Starrable & UniformResourceLocatable & {
  __typename?: 'Repository';
  /** Identifies the date and time when the repository was archived. */
  archivedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The Ref associated with the repository's default branch. */
  defaultBranchRef?: Maybe<Ref>;
  /** Whether or not branches are automatically deleted when merged in this repository. */
  deleteBranchOnMerge: Scalars['Boolean']['output'];
  /** The description of the repository. */
  description?: Maybe<Scalars['String']['output']>;
  /** Returns how many forks there are of this repository in the whole network. */
  forkCount: Scalars['Int']['output'];
  /** Indicates if the repository has the Discussions feature enabled. */
  hasDiscussionsEnabled: Scalars['Boolean']['output'];
  /** Indicates if the repository has issues feature enabled. */
  hasIssuesEnabled: Scalars['Boolean']['output'];
  /** Indicates if the repository has the Projects feature enabled. */
  hasProjectsEnabled: Scalars['Boolean']['output'];
  /** Indicates if the repository has wiki feature enabled. */
  hasWikiEnabled: Scalars['Boolean']['output'];
  /** The repository's URL. */
  homepageUrl?: Maybe<Scalars['URI']['output']>;
  /** The Node ID of the Repository object */
  id: Scalars['ID']['output'];
  /** Indicates if the repository is unmaintained. */
  isArchived: Scalars['Boolean']['output'];
  /** Returns whether or not this repository is empty. */
  isEmpty: Scalars['Boolean']['output'];
  /** Identifies if the repository is a fork. */
  isFork: Scalars['Boolean']['output'];
  /** Indicates if a repository is either owned by an organization, or is a private fork of an organization repository. */
  isInOrganization: Scalars['Boolean']['output'];
  /** Indicates if the repository has been locked or not. */
  isLocked: Scalars['Boolean']['output'];
  /** Identifies if the repository is a mirror. */
  isMirror: Scalars['Boolean']['output'];
  /** Identifies if the repository is private or internal. */
  isPrivate: Scalars['Boolean']['output'];
  /** Identifies if the repository is a template that can be used to generate new repositories. */
  isTemplate: Scalars['Boolean']['output'];
  /** Returns a list of issue templates associated to the repository */
  issueTemplates?: Maybe<Array<IssueTemplate>>;
  /** Get the latest release for the repository if one exists. */
  latestRelease?: Maybe<Release>;
  /** Whether or not PRs are merged with a merge commit on this repository. */
  mergeCommitAllowed: Scalars['Boolean']['output'];
  /** The repository's original mirror URL. */
  mirrorUrl?: Maybe<Scalars['URI']['output']>;
  /** The name of the repository. */
  name: Scalars['String']['output'];
  /** The repository's name with owner. */
  nameWithOwner: Scalars['String']['output'];
  /** A list of direct forked repositories. */
  forks: RepositoryConnection;
  /** A Git object in the repository */
  object?: Maybe<GitObject>;
  /** The User owner of the repository. */
  owner: RepositoryOwner;
  /** The repository parent, if this is a fork. */
  parent?: Maybe<Repository>;
  /** Returns a list of pull request templates associated to the repository */
  pullRequestTemplates?: Maybe<Array<PullRequestTemplate>>;
  /** Identifies the date and time when the repository was last pushed to. */
  pushedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Whether or not rebase-merging is enabled on this repository. */
  rebaseMergeAllowed: Scalars['Boolean']['output'];
  /** Fetch a given ref from the repository */
  ref?: Maybe<Ref>;
  /** Lookup a single release given various criteria. */
  release?: Maybe<Release>;
  /** List of releases which are dependent on this repository. */
  releases: ReleaseConnection;
  /** The HTTP path for this repository */
  resourcePath: Scalars['URI']['output'];
  /** Whether or not squash-merging is enabled on this repository. */
  squashMergeAllowed: Scalars['Boolean']['output'];
  /** The SSH URL to clone this repository */
  sshUrl: Scalars['GitSSHRemote']['output'];
  /** Returns a count of how many stargazers there are on this object */
  stargazerCount: Scalars['Int']['output'];
  /** The repository from which this repository was generated, if any. */
  templateRepository?: Maybe<Repository>;
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** The HTTP URL for this repository */
  url: Scalars['URI']['output'];
  /** Indicates whether the viewer has admin permissions on this repository. */
  viewerCanAdminister: Scalars['Boolean']['output'];
  /** Returns a boolean indicating whether the viewing user has starred this starrable. */
  viewerHasStarred: Scalars['Boolean']['output'];
  /** The users permission level on the repository. Will return null if authenticated as an GitHub App. */
  viewerPermission?: Maybe<RepositoryPermission>;
  /** Indicates the repository's visibility level. */
  visibility: RepositoryVisibility;
  /** A list of labels associated with the repository. */
  labels?: Maybe<LabelConnection>;
  /** Returns a single issue from the current repository by number. */
  issue?: Maybe<Issue>;
  /** Returns a single issue-like object from the current repository by number. */
  issueOrPullRequest?: Maybe<IssueOrPullRequest>;
  /** A list of issues that have been opened in the repository. */
  issues: IssueConnection;
  /** A list of milestones associated with the repository. */
  milestones?: Maybe<MilestoneConnection>;
  /** Returns a single pull request from the current repository by number. */
  pullRequest?: Maybe<PullRequest>;
  /** A list of pull requests that have been opened in the repository. */
  pullRequests: PullRequestConnection;
  /** List of projects linked to this repository. */
  projectsV2: ProjectV2Connection;
  /** Returns a single discussion from the current repository by number. */
  discussion?: Maybe<Discussion>;
  /** A list of discussions that have been opened in the repository. */
  discussions: DiscussionConnection;
  /** A list of discussion categories that are available in the repository. */
  discussionCategories: DiscussionCategoryConnection;
  /** A discussion category by slug. */
  discussionCategory?: Maybe<DiscussionCategory>;
};


/** A repository contains the content for a project. */
export type RepositoryForksArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RepositoryOrder>;
  privacy?: InputMaybe<RepositoryPrivacy>;
};


/** A repository contains the content for a project. */
export type RepositoryObjectArgs = {
  expression?: InputMaybe<Scalars['String']['input']>;
  oid?: InputMaybe<Scalars['GitObjectID']['input']>;
};


/** A repository contains the content for a project. */
export type RepositoryRefArgs = {
  qualifiedName: Scalars['String']['input'];
};


/** A repository contains the content for a project. */
export type RepositoryReleaseArgs = {
  tagName: Scalars['String']['input'];
};


/** A repository contains the content for a project. */
export type RepositoryReleasesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ReleaseOrder>;
};


/** A repository contains the content for a project. */
export type RepositoryLabelsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<LabelOrder>;
  query?: InputMaybe<Scalars['String']['input']>;
};


/** A repository contains the content for a project. */
export type RepositoryIssueArgs = {
  number: Scalars['Int']['input'];
};


/** A repository contains the content for a project. */
export type RepositoryIssueOrPullRequestArgs = {
  number: Scalars['Int']['input'];
};


/** A repository contains the content for a project. */
export type RepositoryIssuesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  orderBy?: InputMaybe<IssueOrder>;
  states?: InputMaybe<Array<IssueState>>;
  filterBy?: InputMaybe<IssueFilters>;
};


/** A repository contains the content for a project. */
export type RepositoryMilestonesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<MilestoneOrder>;
  query?: InputMaybe<Scalars['String']['input']>;
  states?: InputMaybe<Array<MilestoneState>>;
};


/** A repository contains the content for a project. */
export type RepositoryPullRequestArgs = {
  number: Scalars['Int']['input'];
};


/** A repository contains the content for a project. */
export type RepositoryPullRequestsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  states?: InputMaybe<Array<PullRequestState>>;
  baseRefName?: InputMaybe<Scalars['String']['input']>;
  headRefName?: InputMaybe<Scalars['String']['input']>;
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  orderBy?: InputMaybe<IssueOrder>;
};


/** A repository contains the content for a project. */
export type RepositoryProjectsV2Args = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  minPermissionLevel?: InputMaybe<ProjectV2PermissionLevel>;
  orderBy?: InputMaybe<ProjectV2Order>;
  query?: InputMaybe<Scalars['String']['input']>;
};


/** A repository contains the content for a project. */
export type RepositoryDiscussionArgs = {
  number: Scalars['Int']['input'];
};


/** A repository contains the content for a project. */
export type RepositoryDiscussionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  answered?: InputMaybe<Scalars['Boolean']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  categoryId?: InputMaybe<Scalars['ID']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DiscussionOrder>;
};


/** A repository contains the content for a project. */
export type RepositoryDiscussionCategoriesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository contains the content for a project. */
export type RepositoryDiscussionCategoryArgs = {
  slug: Scalars['String']['input'];
};

/** A list of repositories owned by the subject. */
export type RepositoryConnection = {
  __typename?: 'RepositoryConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<RepositoryEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Repository>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type RepositoryEdge = {
  __typename?: 'RepositoryEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Repository>;
};

/** Represents a Git reference. */
export type Ref = Node & {
  __typename?: 'Ref';
  /** The Node ID of the Ref object */
  id: Scalars['ID']['output'];
  /** The ref name. */
  name: Scalars['String']['output'];
  /** The ref's prefix, such as `refs/heads/` or `refs/tags/`. */
  prefix: Scalars['String']['output'];
  /** The object the ref points to. Returns null when object does not exist. */
  target?: Maybe<GitObject>;
  /** Branch protection rules for this ref */
  branchProtectionRule?: Maybe<BranchProtectionRule>;
};

/** A branch protection rule. */
export type BranchProtectionRule = {
  __typename?: 'BranchProtectionRule';
  /** Are branches required to be up to date before merging. */
  requiresStrictStatusChecks: Scalars['Boolean']['output'];
};

/** Represents a Git object. */
export type GitObject = {
  /** An abbreviated version of the Git object ID */
  abbreviatedOid: Scalars['String']['output'];
  /** The Node ID of the GitObject object */
  id: Scalars['ID']['output'];
  /** The Git object ID */
  oid: Scalars['GitObjectID']['output'];
  /** The Repository the Git object belongs to */
  repository: Repository;
};

/** Represents a Git commit. */
export type Commit = GitObject & Node & {
  __typename?: 'Commit';
  /** An abbreviated version of the Git object ID */
  abbreviatedOid: Scalars['String']['output'];
  /** The datetime when this commit was authored. */
  authoredDate: Scalars['DateTime']['output'];
  /** The datetime when this commit was committed. */
  committedDate: Scalars['DateTime']['output'];
  /** The Node ID of the Commit object */
  id: Scalars['ID']['output'];
  /** The Git commit message */
  message: Scalars['String']['output'];
  /** The Git commit message headline */
  messageHeadline: Scalars['String']['output'];
  /** The Git object ID */
  oid: Scalars['GitObjectID']['output'];
  /** Commit signing information, if present. */
  signature?: Maybe<GitSignature>;
  /** The Repository this commit belongs to */
  repository: Repository;
  /** The HTTP path for this commit */
  resourcePath: Scalars['URI']['output'];
  /** The HTTP URL for this commit */
  url: Scalars['URI']['output'];
  /** Fetches `git blame` information. */
  blame: Blame;
  /**
   * Returns a URL to download a zipball archive for a repository.
   * Note: For private repositories, these links are temporary and expire after five minutes.
   */
  zipballUrl: Scalars['URI']['output'];
  /**
   * Returns a URL to download a tarball archive for a repository.
   * Note: For private repositories, these links are temporary and expire after five minutes.
   */
  tarballUrl: Scalars['URI']['output'];
  /** Check and Status rollup information for this commit. */
  statusCheckRollup?: Maybe<StatusCheckRollup>;
  /** The Git commit message body */
  messageBody: Scalars['String']['output'];
  /**
   * The list of authors for this commit based on the git author and the Co-authored-by
   * message trailer. The git author will always be first.
   */
  authors: GitActorConnection;
};


/** Represents a Git commit. */
export type CommitBlameArgs = {
  path: Scalars['String']['input'];
};


/** Represents a Git commit. */
export type CommitAuthorsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** Represents a Git blame. */
export type Blame = {
  __typename?: 'Blame';
  /** The list of ranges from a Git blame. */
  ranges: Array<BlameRange>;
};

/** Represents a range of information from a Git blame. */
export type BlameRange = {
  __typename?: 'BlameRange';
  /**
   * Identifies the recency of the change, from 1 (new) to 10 (old). This is
   * calculated as a 2-quantile and determines the length of distance between the
   * median age of all the changes in the file and the recency of the current
   * range's change.
   */
  age: Scalars['Int']['output'];
  /** Identifies the line author */
  commit: Commit;
  /** The ending line for the range */
  endingLine: Scalars['Int']['output'];
  /** The starting line for the range */
  startingLine: Scalars['Int']['output'];
};

/** Ordering options for repository connections */
export type RepositoryOrder = {
  /** The ordering direction. */
  direction: OrderDirection;
  /** The field to order repositories by. */
  field: RepositoryOrderField;
};

/** Properties by which repository connections can be ordered. */
export type RepositoryOrderField =
  /** Order repositories by creation time */
  | 'CREATED_AT'
  /** Order repositories by name */
  | 'NAME'
  /** Order repositories by push time */
  | 'PUSHED_AT'
  /** Order repositories by number of stargazers */
  | 'STARGAZERS'
  /** Order repositories by update time */
  | 'UPDATED_AT';

/** Possible directions in which to order a list of items when provided an `orderBy` argument. */
export type OrderDirection =
  /** Specifies an ascending order for a given `orderBy` argument. */
  | 'ASC'
  /** Specifies a descending order for a given `orderBy` argument. */
  | 'DESC';

/** The privacy of a repository */
export type RepositoryPrivacy =
  /** Private */
  | 'PRIVATE'
  /** Public */
  | 'PUBLIC';

/** The affiliation of a user to a repository */
export type RepositoryAffiliation =
  /** Repositories that the user has been added to as a collaborator. */
  | 'COLLABORATOR'
  /**
   * Repositories that the user has access to through being a member of an
   * organization. This includes every repository on every team that the user is on.
   */
  | 'ORGANIZATION_MEMBER'
  /** Repositories that are owned by the authenticated user. */
  | 'OWNER';

/** The access level to a repository */
export type RepositoryPermission =
  /**
   * Can read, clone, and push to this repository. Can also manage issues, pull
   * requests, and repository settings, including adding collaborators
   */
  | 'ADMIN'
  /** Can read, clone, and push to this repository. They can also manage issues, pull requests, and some repository settings */
  | 'MAINTAIN'
  /** Can read and clone this repository. Can also moderate and edit issues and manage pull requests without write access */
  | 'MODERATE'
  /** Can read and clone this repository. Can also open and comment on issues and pull requests */
  | 'READ'
  /** Can read and clone this repository. Can also manage issues and pull requests */
  | 'TRIAGE'
  /** Can read and clone this repository. Can also moderate and edit issues and manage pull requests without write access */
  | 'TRIAGE_PLUS'
  /** Can read, clone, and push to this repository. Can also manage issues and pull requests */
  | 'WRITE';

/** The repository's visibility level. */
export type RepositoryVisibility =
  /** The repository is visible only to users in the same enterprise. */
  | 'INTERNAL'
  /** The repository is visible only to those with explicit access. */
  | 'PRIVATE'
  /** The repository is visible to everyone. */
  | 'PUBLIC';

/** Autogenerated input type of CreateRepository */
export type CreateRepositoryInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** A short description of the new repository. */
  description?: InputMaybe<Scalars['String']['input']>;
  /** Indicates if the repository should have the issues feature enabled. */
  hasIssuesEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** Indicates if the repository should have the wiki feature enabled. */
  hasWikiEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** The URL for a web page about this repository. */
  homepageUrl?: InputMaybe<Scalars['URI']['input']>;
  /** The name of the new repository. */
  name: Scalars['String']['input'];
  /** The ID of the owner for the new repository. */
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  /**
   * When an organization is specified as the owner, this ID identifies the team
   * that should be granted access to the new repository.
   */
  teamId?: InputMaybe<Scalars['ID']['input']>;
  /**
   * Whether this repository should be marked as a template such that anyone who
   * can access it can create new repositories with the same files and directory structure.
   */
  template?: InputMaybe<Scalars['Boolean']['input']>;
  /** Indicates the repository's visibility level. */
  visibility: RepositoryVisibility;
};

/** Autogenerated return type of CreateRepository. */
export type CreateRepositoryPayload = {
  __typename?: 'CreateRepositoryPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The new repository. */
  repository?: Maybe<Repository>;
};

/** Autogenerated input type of UpdateRepository */
export type UpdateRepositoryInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The ID of the repository to update. */
  repositoryId: Scalars['ID']['input'];
  /** The new name of the repository. */
  name?: InputMaybe<Scalars['String']['input']>;
  /** A new description for the repository. Pass an empty string to erase the existing description. */
  description?: InputMaybe<Scalars['String']['input']>;
  /** The URL for a web page about this repository. Pass an empty string to erase the existing URL. */
  homepageUrl?: InputMaybe<Scalars['URI']['input']>;
  /** Indicates if the repository should have the issues feature enabled. */
  hasIssuesEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** Indicates if the repository should have the wiki feature enabled. */
  hasWikiEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** Indicates if the repository should have the project boards feature enabled. */
  hasProjectsEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  /**
   * Whether this repository should be marked as a template such that anyone who
   * can access it can create new repositories with the same files and directory structure.
   */
  template?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Autogenerated return type of UpdateRepository. */
export type UpdateRepositoryPayload = {
  __typename?: 'UpdateRepositoryPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The updated repository. */
  repository?: Maybe<Repository>;
};

/** Autogenerated input type of CreateLabel */
export type CreateLabelInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** A 6 character hex code, without the leading #, identifying the color of the label. */
  color: Scalars['String']['input'];
  /** A brief description of the label, such as its purpose. */
  description?: InputMaybe<Scalars['String']['input']>;
  /** The name of the label. */
  name: Scalars['String']['input'];
  /** The Node ID of the repository. */
  repositoryId: Scalars['ID']['input'];
};

/** Autogenerated return type of CreateLabel. */
export type CreateLabelPayload = {
  __typename?: 'CreateLabelPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The new label. */
  label?: Maybe<Label>;
};

/** Autogenerated input type of UpdateLabel */
export type UpdateLabelInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** A 6 character hex code, without the leading #, identifying the updated color of the label. */
  color?: InputMaybe<Scalars['String']['input']>;
  /** A brief description of the label, such as its purpose. */
  description?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the label to be updated. */
  id: Scalars['ID']['input'];
  /** The updated name of the label. */
  name?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of UpdateLabel. */
export type UpdateLabelPayload = {
  __typename?: 'UpdateLabelPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The updated label. */
  label?: Maybe<Label>;
};

/** Autogenerated input type of DeleteLabel */
export type DeleteLabelInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the label to be deleted. */
  id: Scalars['ID']['input'];
};

/** Autogenerated return type of DeleteLabel. */
export type DeleteLabelPayload = {
  __typename?: 'DeleteLabelPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
};

/** Ways in which lists of labels can be ordered upon return. */
export type LabelOrder = {
  /** The direction in which to order labels by the specified field. */
  direction: OrderDirection;
  /** The field in which to order labels by. */
  field: LabelOrderField;
};

/** Properties by which label connections can be ordered. */
export type LabelOrderField =
  /** Order labels by creation time */
  | 'CREATED_AT'
  /** Order labels by issue count */
  | 'ISSUE_COUNT'
  /** Order labels by name */
  | 'NAME';

/** A release contains the content for a release. */
export type Release = Node & UniformResourceLocatable & {
  __typename?: 'Release';
  /** The author of the release */
  author?: Maybe<User>;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The description of the release. */
  description?: Maybe<Scalars['String']['output']>;
  /** The Node ID of the Release object */
  id: Scalars['ID']['output'];
  /** Whether or not the release is immutable */
  immutable: Scalars['Boolean']['output'];
  /** Whether or not the release is a draft */
  isDraft: Scalars['Boolean']['output'];
  /** Whether or not the release is the latest releast */
  isLatest: Scalars['Boolean']['output'];
  /** Whether or not the release is a prerelease */
  isPrerelease: Scalars['Boolean']['output'];
  /** The title of the release. */
  name?: Maybe<Scalars['String']['output']>;
  /** Identifies the date and time when the release was created. */
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  /** List of releases assets which are dependent on this release. */
  releaseAssets: ReleaseAssetConnection;
  /** The repository that the release belongs to. */
  repository: Repository;
  /** The HTTP path for this issue */
  resourcePath: Scalars['URI']['output'];
  /** The name of the release's Git tag */
  tagName: Scalars['String']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** The HTTP URL for this issue */
  url: Scalars['URI']['output'];
  /** The tag commit for this release. */
  tagCommit?: Maybe<Commit>;
};


/** A release contains the content for a release. */
export type ReleaseReleaseAssetsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

/** A release asset contains the content for a release asset. */
export type ReleaseAsset = Node & {
  __typename?: 'ReleaseAsset';
  /** The asset's content-type */
  contentType: Scalars['String']['output'];
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** The number of times this asset was downloaded */
  downloadCount: Scalars['Int']['output'];
  /** Identifies the URL where you can download the release asset via the browser. */
  downloadUrl: Scalars['URI']['output'];
  /** The Node ID of the ReleaseAsset object */
  id: Scalars['ID']['output'];
  /** Identifies the title of the release asset. */
  name: Scalars['String']['output'];
  /** Release that the asset is associated with */
  release?: Maybe<Release>;
  /** The size (in bytes) of the asset */
  size: Scalars['Int']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** The user that performed the upload */
  uploadedBy: User;
  /** Identifies the URL of the release asset. */
  url: Scalars['URI']['output'];
};

/** The connection type for Release. */
export type ReleaseConnection = {
  __typename?: 'ReleaseConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<ReleaseEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Release>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type ReleaseEdge = {
  __typename?: 'ReleaseEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Release>;
};

/** The connection type for ReleaseAsset. */
export type ReleaseAssetConnection = {
  __typename?: 'ReleaseAssetConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<ReleaseAssetEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<ReleaseAsset>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type ReleaseAssetEdge = {
  __typename?: 'ReleaseAssetEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<ReleaseAsset>;
};

/** Ways in which lists of releases can be ordered upon return. */
export type ReleaseOrder = {
  /** The direction in which to order releases by the specified field. */
  direction: OrderDirection;
  /** The field in which to order releases by. */
  field: ReleaseOrderField;
};

/** Properties by which release connections can be ordered. */
export type ReleaseOrderField =
  /** Order releases by creation time */
  | 'CREATED_AT'
  /** Order releases alphabetically by name */
  | 'NAME';

/** A repository issue template. */
export type IssueTemplate = {
  __typename?: 'IssueTemplate';
  /** The template purpose. */
  about?: Maybe<Scalars['String']['output']>;
  /** The suggested assignees. */
  assignees: UserConnection;
  /** The suggested issue body. */
  body?: Maybe<Scalars['String']['output']>;
  /** The template filename. */
  filename: Scalars['String']['output'];
  /** The suggested issue labels */
  labels?: Maybe<LabelConnection>;
  /** The template name. */
  name: Scalars['String']['output'];
  /** The suggested issue title. */
  title?: Maybe<Scalars['String']['output']>;
};


/** A repository issue template. */
export type IssueTemplateAssigneesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository issue template. */
export type IssueTemplateLabelsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** A repository pull request template. */
export type PullRequestTemplate = {
  __typename?: 'PullRequestTemplate';
  /** The body of the template */
  body?: Maybe<Scalars['String']['output']>;
  /** The filename of the template */
  filename?: Maybe<Scalars['String']['output']>;
  /** The repository the template belongs to */
  repository: Repository;
};

/** Information about a signature (GPG or S/MIME) on a Commit or Tag. */
export type GitSignature = {
  /** Email used to sign this object. */
  email: Scalars['String']['output'];
  /** True if the signature is valid and verified by GitHub. */
  isValid: Scalars['Boolean']['output'];
  /** Payload for GPG signing object. Raw ODB object without the signature header. */
  payload: Scalars['String']['output'];
  /** ASCII-armored signature header from object. */
  signature: Scalars['String']['output'];
  /** GitHub user corresponding to the email signing this commit. */
  signer?: Maybe<User>;
  /**
   * The state of this signature. `VALID` if signature is valid and verified by
   * GitHub, otherwise represents reason why signature is considered invalid.
   */
  state: GitSignatureState;
  /** The date the signature was verified, if valid */
  verifiedAt?: Maybe<Scalars['DateTime']['output']>;
  /** True if the signature was made with GitHub's signing key. */
  wasSignedByGitHub: Scalars['Boolean']['output'];
};

/** The state of a Git signature. */
export type GitSignatureState =
  /** The signing certificate or its chain could not be verified */
  | 'BAD_CERT'
  /** Invalid email used for signing */
  | 'BAD_EMAIL'
  /** Signing key expired */
  | 'EXPIRED_KEY'
  /** Internal error - the GPG verification service misbehaved */
  | 'GPGVERIFY_ERROR'
  /** Internal error - the GPG verification service is unavailable at the moment */
  | 'GPGVERIFY_UNAVAILABLE'
  /** Invalid signature */
  | 'INVALID'
  /** Malformed signature */
  | 'MALFORMED_SIG'
  /** The usage flags for the key that signed this don't allow signing */
  | 'NOT_SIGNING_KEY'
  /** Email used for signing not known to GitHub */
  | 'NO_USER'
  /** Valid signature, though certificate revocation check failed */
  | 'OCSP_ERROR'
  /** Valid signature, pending certificate revocation checking */
  | 'OCSP_PENDING'
  /** One or more certificates in chain has been revoked */
  | 'OCSP_REVOKED'
  /** Key used for signing not known to GitHub */
  | 'UNKNOWN_KEY'
  /** Unknown signature type */
  | 'UNKNOWN_SIG_TYPE'
  /** Unsigned */
  | 'UNSIGNED'
  /** Email used for signing unverified on GitHub */
  | 'UNVERIFIED_EMAIL'
  /** Valid signature and verified by GitHub */
  | 'VALID';

/** Represents a GPG signature on a Commit or Tag. */
export type GpgSignature = GitSignature & {
  __typename?: 'GpgSignature';
  /** Email used to sign this object. */
  email: Scalars['String']['output'];
  /** True if the signature is valid and verified by GitHub. */
  isValid: Scalars['Boolean']['output'];
  /** Hex-encoded ID of the key that signed this object. */
  keyId?: Maybe<Scalars['String']['output']>;
  /** Payload for GPG signing object. Raw ODB object without the signature header. */
  payload: Scalars['String']['output'];
  /** ASCII-armored signature header from object. */
  signature: Scalars['String']['output'];
  /** GitHub user corresponding to the email signing this commit. */
  signer?: Maybe<User>;
  /**
   * The state of this signature. `VALID` if signature is valid and verified by
   * GitHub, otherwise represents reason why signature is considered invalid.
   */
  state: GitSignatureState;
  /** The date the signature was verified, if valid */
  verifiedAt?: Maybe<Scalars['DateTime']['output']>;
  /** True if the signature was made with GitHub's signing key. */
  wasSignedByGitHub: Scalars['Boolean']['output'];
};

/** Represents an SSH signature on a Commit or Tag. */
export type SshSignature = GitSignature & {
  __typename?: 'SshSignature';
  /** Email used to sign this object. */
  email: Scalars['String']['output'];
  /** True if the signature is valid and verified by GitHub. */
  isValid: Scalars['Boolean']['output'];
  /** Hex-encoded fingerprint of the key that signed this object. */
  keyFingerprint?: Maybe<Scalars['String']['output']>;
  /** Payload for GPG signing object. Raw ODB object without the signature header. */
  payload: Scalars['String']['output'];
  /** ASCII-armored signature header from object. */
  signature: Scalars['String']['output'];
  /** GitHub user corresponding to the email signing this commit. */
  signer?: Maybe<User>;
  /**
   * The state of this signature. `VALID` if signature is valid and verified by
   * GitHub, otherwise represents reason why signature is considered invalid.
   */
  state: GitSignatureState;
  /** The date the signature was verified, if valid */
  verifiedAt?: Maybe<Scalars['DateTime']['output']>;
  /** True if the signature was made with GitHub's signing key. */
  wasSignedByGitHub: Scalars['Boolean']['output'];
};

/** An account on GitHub, with one or more owners, that has repositories, members and teams. */
export type Organization = Actor & Node & RepositoryOwner & UniformResourceLocatable & ProjectV2Owner & {
  __typename?: 'Organization';
  /** A URL pointing to the organization's public avatar. */
  avatarUrl: Scalars['URI']['output'];
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The organization's public profile description. */
  description?: Maybe<Scalars['String']['output']>;
  /** The organization's public email. */
  email?: Maybe<Scalars['String']['output']>;
  /** The Node ID of the Organization object */
  id: Scalars['ID']['output'];
  /** Whether the organization has verified its profile email and website. */
  isVerified: Scalars['Boolean']['output'];
  /** The organization's public profile location. */
  location?: Maybe<Scalars['String']['output']>;
  /** The organization's login name. */
  login: Scalars['String']['output'];
  /** The organization's public profile name. */
  name?: Maybe<Scalars['String']['output']>;
  /** A list of repositories that the user owns. */
  repositories: RepositoryConnection;
  /** Find Repository. */
  repository?: Maybe<Repository>;
  /** The HTTP path for this organization. */
  resourcePath: Scalars['URI']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** The HTTP URL for this organization. */
  url: Scalars['URI']['output'];
  /** The organization's public profile URL. */
  websiteUrl?: Maybe<Scalars['URI']['output']>;
  /** A list of teams in this organization. */
  teams: TeamConnection;
  /** Find a project by number. */
  projectV2?: Maybe<ProjectV2>;
  /** A list of projects under the owner. */
  projectsV2: ProjectV2Connection;
};


/** An account on GitHub, with one or more owners, that has repositories, members and teams. */
export type OrganizationAvatarUrlArgs = {
  size?: InputMaybe<Scalars['Int']['input']>;
};


/** An account on GitHub, with one or more owners, that has repositories, members and teams. */
export type OrganizationRepositoriesArgs = {
  affiliations?: InputMaybe<Array<InputMaybe<RepositoryAffiliation>>>;
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  isArchived?: InputMaybe<Scalars['Boolean']['input']>;
  isFork?: InputMaybe<Scalars['Boolean']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RepositoryOrder>;
  ownerAffiliations?: InputMaybe<Array<InputMaybe<RepositoryAffiliation>>>;
  privacy?: InputMaybe<RepositoryPrivacy>;
  visibility?: InputMaybe<RepositoryVisibility>;
};


/** An account on GitHub, with one or more owners, that has repositories, members and teams. */
export type OrganizationRepositoryArgs = {
  name: Scalars['String']['input'];
};


/** An account on GitHub, with one or more owners, that has repositories, members and teams. */
export type OrganizationTeamsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  userLogins?: InputMaybe<Array<Scalars['String']['input']>>;
};


/** An account on GitHub, with one or more owners, that has repositories, members and teams. */
export type OrganizationProjectV2Args = {
  number: Scalars['Int']['input'];
};


/** An account on GitHub, with one or more owners, that has repositories, members and teams. */
export type OrganizationProjectsV2Args = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  minPermissionLevel?: InputMaybe<ProjectV2PermissionLevel>;
  orderBy?: InputMaybe<ProjectV2Order>;
  query?: InputMaybe<Scalars['String']['input']>;
};

/** A list of organizations managed by an enterprise. */
export type OrganizationConnection = {
  __typename?: 'OrganizationConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<OrganizationEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Organization>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type OrganizationEdge = {
  __typename?: 'OrganizationEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Organization>;
};

/** A team of users in an organization. */
export type Team = Node & {
  __typename?: 'Team';
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The description of the team. */
  description?: Maybe<Scalars['String']['output']>;
  /** The Node ID of the Team object */
  id: Scalars['ID']['output'];
  /** The name of the team. */
  name: Scalars['String']['output'];
  /** A list of users who are members of this team. */
  members: TeamMemberConnection;
  /** The notification setting that the team has set. */
  notificationSetting: TeamNotificationSetting;
  /** The organization that owns this team. */
  organization: Organization;
  /** The parent team of the team. */
  parentTeam?: Maybe<Team>;
  /** The level of privacy the team has. */
  privacy: TeamPrivacy;
  /** A list of repositories this team has access to. */
  repositories: TeamRepositoryConnection;
  /** List of child teams belonging to this team */
  childTeams: TeamConnection;
  /** The slug corresponding to the team. */
  slug: Scalars['String']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** The HTTP URL for this team */
  url: Scalars['URI']['output'];
};


/** A team of users in an organization. */
export type TeamMembersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A team of users in an organization. */
export type TeamRepositoriesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A team of users in an organization. */
export type TeamChildTeamsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  immediateOnly?: InputMaybe<Scalars['Boolean']['input']>;
  userLogins?: InputMaybe<Array<Scalars['String']['input']>>;
};

/** The connection type for Team. */
export type TeamConnection = {
  __typename?: 'TeamConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<TeamEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Team>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type TeamEdge = {
  __typename?: 'TeamEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Team>;
};

/** The connection type for User. */
export type TeamMemberConnection = {
  __typename?: 'TeamMemberConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<TeamMemberEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<User>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** Represents a user who is a member of a team. */
export type TeamMemberEdge = {
  __typename?: 'TeamMemberEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The HTTP path to the organization's member access page. */
  memberAccessResourcePath: Scalars['URI']['output'];
  /** The HTTP URL to the organization's member access page. */
  memberAccessUrl: Scalars['URI']['output'];
  node: User;
  /** The role the member has on the team. */
  role: TeamMemberRole;
};

/** The possible team member roles; either 'maintainer' or 'member'. */
export type TeamMemberRole =
  /** A team maintainer has permission to add and remove team members. */
  | 'MAINTAINER'
  /** A team member has no administrative permissions on the team. */
  | 'MEMBER';

/** The connection type for Repository. */
export type TeamRepositoryConnection = {
  __typename?: 'TeamRepositoryConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<TeamRepositoryEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Repository>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** Represents a team repository. */
export type TeamRepositoryEdge = {
  __typename?: 'TeamRepositoryEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  node: Repository;
  /** The permission level the team has on the repository */
  permission: RepositoryPermission;
};

/** The possible team privacy values. */
export type TeamPrivacy =
  /** A secret team can only be seen by its members. */
  | 'SECRET'
  /** A visible team can be seen and @mentioned by every member of the organization. */
  | 'VISIBLE';

/** The possible team notification values. */
export type TeamNotificationSetting =
  /** No one will receive notifications. */
  | 'NOTIFICATIONS_DISABLED'
  /** Everyone will receive notifications when the team is @mentioned. */
  | 'NOTIFICATIONS_ENABLED';

/** An Issue is a place to discuss ideas, enhancements, tasks, and bugs for a project. */
export type Issue = Assignable & Labelable & Node & UniformResourceLocatable & {
  __typename?: 'Issue';
  /** The Node ID of the Issue object */
  id: Scalars['ID']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** Identifies the issue number. */
  number: Scalars['Int']['output'];
  /** Identifies the issue title. */
  title: Scalars['String']['output'];
  /** Identifies the body of the issue. */
  body: Scalars['String']['output'];
  /** Identifies the state of the issue. */
  state: IssueState;
  /** Identifies the reason for the issue state. */
  stateReason?: Maybe<IssueStateReason>;
  /** The HTTP URL for this issue */
  url: Scalars['URI']['output'];
  /** The HTTP path for this issue */
  resourcePath: Scalars['URI']['output'];
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was closed. */
  closedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Indicates if the object is closed (definition of closed may depend on type) */
  closed: Scalars['Boolean']['output'];
  /** The actor who authored the comment. */
  author?: Maybe<Actor>;
  /** The repository associated with this node. */
  repository: Repository;
  /** Identifies the milestone associated with the issue. */
  milestone?: Maybe<Milestone>;
  /** A list of Users assigned to this object. */
  assignees: UserConnection;
  /** A list of labels associated with the object. */
  labels?: Maybe<LabelConnection>;
  /** A list of comments associated with the Issue. */
  comments: IssueCommentConnection;
  /**
   * List of project cards associated with this issue.
   * @deprecated Projects (classic) is being deprecated in favor of the new Projects experience, see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. Removal on 2025-04-01 UTC.
   */
  projectCards: ProjectCardConnection;
  /** A list of reactions grouped by content left on the subject. */
  reactionGroups?: Maybe<Array<ReactionGroup>>;
  /** The issue type for this Issue */
  issueType?: Maybe<IssueType>;
  /** The parent entity of the issue. */
  parent?: Maybe<Issue>;
  /** A list of sub-issues associated with the Issue. */
  subIssues: IssueConnection;
  /** Summary of the state of an issue's sub-issues */
  subIssuesSummary: SubIssuesSummary;
  /** List of project items associated with this issue. */
  projectItems?: Maybe<ProjectV2ItemConnection>;
};


/** An Issue is a place to discuss ideas, enhancements, tasks, and bugs for a project. */
export type IssueStateReasonArgs = {
  enableDuplicate?: InputMaybe<Scalars['Boolean']['input']>;
};


/** An Issue is a place to discuss ideas, enhancements, tasks, and bugs for a project. */
export type IssueAssigneesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** An Issue is a place to discuss ideas, enhancements, tasks, and bugs for a project. */
export type IssueLabelsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** An Issue is a place to discuss ideas, enhancements, tasks, and bugs for a project. */
export type IssueCommentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** An Issue is a place to discuss ideas, enhancements, tasks, and bugs for a project. */
export type IssueProjectCardsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** An Issue is a place to discuss ideas, enhancements, tasks, and bugs for a project. */
export type IssueSubIssuesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** An Issue is a place to discuss ideas, enhancements, tasks, and bugs for a project. */
export type IssueProjectItemsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  includeArchived?: InputMaybe<Scalars['Boolean']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** Used for return value of Repository.issueOrPullRequest. */
export type IssueOrPullRequest = Issue | PullRequest;

/** Represents a Milestone object on a given repository. */
export type Milestone = Node & {
  __typename?: 'Milestone';
  /** The Node ID of the Milestone object */
  id: Scalars['ID']['output'];
  /** Identifies the number of the milestone. */
  number: Scalars['Int']['output'];
  /** Identifies the title of the milestone. */
  title: Scalars['String']['output'];
  /** Identifies the description of the milestone. */
  description?: Maybe<Scalars['String']['output']>;
  /** Identifies the due date of the milestone. */
  dueOn?: Maybe<Scalars['DateTime']['output']>;
  /** Identifies the state of the milestone. */
  state: MilestoneState;
};

/** The connection type for Milestone. */
export type MilestoneConnection = {
  __typename?: 'MilestoneConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<MilestoneEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Milestone>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type MilestoneEdge = {
  __typename?: 'MilestoneEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Milestone>;
};

/** The possible states of a milestone. */
export type MilestoneState =
  /** A milestone that has been closed. */
  | 'CLOSED'
  /** A milestone that is still open. */
  | 'OPEN';

/** Ordering options for milestone connections. */
export type MilestoneOrder = {
  /** The ordering direction. */
  direction: OrderDirection;
  /** The field to order milestones by. */
  field: MilestoneOrderField;
};

/** Properties by which milestone connections can be ordered. */
export type MilestoneOrderField =
  /** Order milestones by when they were created. */
  | 'CREATED_AT'
  /** Order milestones by when they are due. */
  | 'DUE_DATE'
  /** Order milestones by their number. */
  | 'NUMBER'
  /** Order milestones by when they were last updated. */
  | 'UPDATED_AT';

/** The connection type for ProjectCard. */
export type ProjectCardConnection = {
  __typename?: 'ProjectCardConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<ProjectCardEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<ProjectCard>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type ProjectCardEdge = {
  __typename?: 'ProjectCardEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<ProjectCard>;
};

/** A card in a project. */
export type ProjectCard = {
  __typename?: 'ProjectCard';
  /**
   * The project that contains this card.
   * @deprecated Projects (classic) is being deprecated in favor of the new Projects experience, see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. Removal on 2025-04-01 UTC.
   */
  project: Project;
  /**
   * The project column this card is associated under. A card may only belong to one
   * project column at a time. The column field will be null if the card is created
   * in a pending state and has yet to be associated with a column. Once cards are
   * associated with a column, they will not become pending in the future.
   * @deprecated Projects (classic) is being deprecated in favor of the new Projects experience, see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. Removal on 2025-04-01 UTC.
   */
  column?: Maybe<ProjectColumn>;
};

/** Projects manage issues, pull requests and notes within a project owner. */
export type Project = {
  __typename?: 'Project';
  /**
   * The project's name.
   * @deprecated Projects (classic) is being deprecated in favor of the new Projects experience, see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. Removal on 2025-04-01 UTC.
   */
  name: Scalars['String']['output'];
};

/** A column inside a project. */
export type ProjectColumn = {
  __typename?: 'ProjectColumn';
  /**
   * The project column's name.
   * @deprecated Projects (classic) is being deprecated in favor of the new Projects experience, see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. Removal on 2025-04-01 UTC.
   */
  name: Scalars['String']['output'];
};

/** The connection type for Issue. */
export type IssueConnection = {
  __typename?: 'IssueConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<IssueEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Issue>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type IssueEdge = {
  __typename?: 'IssueEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Issue>;
};

/** The possible states of an issue. */
export type IssueState =
  /** An issue that has been closed */
  | 'CLOSED'
  /** An issue that is still open */
  | 'OPEN';

/** The possible state reasons of an issue. */
export type IssueStateReason =
  /** An issue that has been closed as completed */
  | 'COMPLETED'
  /** An issue that has been closed as a duplicate. */
  | 'DUPLICATE'
  /** An issue that has been closed as not planned */
  | 'NOT_PLANNED'
  /** An issue that has been reopened */
  | 'REOPENED';

/** Ways in which to filter lists of issues. */
export type IssueFilters = {
  /**
   * List issues assigned to given name. Pass in `null` for issues with no assigned
   * user, and `*` for issues assigned to any user.
   */
  assignee?: InputMaybe<Scalars['String']['input']>;
  /** List issues created by given name. */
  createdBy?: InputMaybe<Scalars['String']['input']>;
  /** List issues where the list of label names exist on the issue. */
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  /** List issues where the given name is mentioned in the issue. */
  mentioned?: InputMaybe<Scalars['String']['input']>;
  /**
   * List issues by given milestone argument. If an string representation of an
   * integer is passed, it should refer to a milestone by its database ID. Pass in
   * `null` for issues with no milestone, and `*` for issues that are assigned to any milestone.
   */
  milestone?: InputMaybe<Scalars['String']['input']>;
  /** List issues that have been updated at or after the given date. */
  since?: InputMaybe<Scalars['DateTime']['input']>;
  /** List issues filtered by the list of states given. */
  states?: InputMaybe<Array<IssueState>>;
  /** List issues subscribed to by viewer. */
  viewerSubscribed?: InputMaybe<Scalars['Boolean']['input']>;
};

/** The possible color for an issue type */
export type IssueTypeColor =
  /** blue */
  | 'BLUE'
  /** gray */
  | 'GRAY'
  /** green */
  | 'GREEN'
  /** orange */
  | 'ORANGE'
  /** pink */
  | 'PINK'
  /** purple */
  | 'PURPLE'
  /** red */
  | 'RED'
  /** yellow */
  | 'YELLOW';

/** Represents the type of Issue. */
export type IssueType = Node & {
  __typename?: 'IssueType';
  /** The Node ID of the IssueType object */
  id: Scalars['ID']['output'];
  /** The issue type's name. */
  name: Scalars['String']['output'];
  /** The issue type's description. */
  description?: Maybe<Scalars['String']['output']>;
  /** The issue type's color. */
  color: IssueTypeColor;
};

/** Summary of the state of an issue's sub-issues */
export type SubIssuesSummary = {
  __typename?: 'SubIssuesSummary';
  /** Count of completed sub-issues */
  completed: Scalars['Int']['output'];
  /** Percent of sub-issues which are completed */
  percentCompleted: Scalars['Int']['output'];
  /** Count of total number of sub-issues */
  total: Scalars['Int']['output'];
};

/** An object that can have labels assigned to it. */
export type Labelable = {
  /** A list of labels associated with the object. */
  labels?: Maybe<LabelConnection>;
};


/** An object that can have labels assigned to it. */
export type LabelableLabelsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** An object that can have users assigned to it. */
export type Assignable = {
  /** A list of Users assigned to this object. */
  assignees: UserConnection;
};


/** An object that can have users assigned to it. */
export type AssignableAssigneesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** Autogenerated input type of CreateIssue */
export type CreateIssueInput = {
  /** The Node ID of the repository. */
  repositoryId: Scalars['ID']['input'];
  /** The title for the issue. */
  title: Scalars['String']['input'];
  /** The body for the issue description. */
  body?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of assignees for this issue. */
  assigneeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** An array of Node IDs of labels for this issue. */
  labelIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** The Node ID of the milestone for this issue. */
  milestoneId?: InputMaybe<Scalars['ID']['input']>;
  /** An array of Node IDs for projects associated with this issue. */
  projectIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of CreateIssue. */
export type CreateIssuePayload = {
  __typename?: 'CreateIssuePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The new issue. */
  issue?: Maybe<Issue>;
};

/** Autogenerated input type of UpdateIssue */
export type UpdateIssueInput = {
  /** The ID of the Issue to modify. */
  id: Scalars['ID']['input'];
  /** The title for the issue. */
  title?: InputMaybe<Scalars['String']['input']>;
  /** The body for the issue description. */
  body?: InputMaybe<Scalars['String']['input']>;
  /** The desired issue state. */
  state?: InputMaybe<IssueState>;
  /** An array of Node IDs of users or bots for this issue. */
  assigneeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** An array of Node IDs of labels for this issue. */
  labelIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** The Node ID of the milestone for this issue. */
  milestoneId?: InputMaybe<Scalars['ID']['input']>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of UpdateIssue. */
export type UpdateIssuePayload = {
  __typename?: 'UpdateIssuePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The issue. */
  issue?: Maybe<Issue>;
};

/** Autogenerated input type of CloseIssue */
export type CloseIssueInput = {
  /** ID of the issue to be closed. */
  issueId: Scalars['ID']['input'];
  /** The reason the issue is to be closed. */
  stateReason?: InputMaybe<IssueClosedStateReason>;
  /** ID of the issue that this is a duplicate of. */
  duplicateIssueId?: InputMaybe<Scalars['ID']['input']>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of CloseIssue. */
export type CloseIssuePayload = {
  __typename?: 'CloseIssuePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The issue that was closed. */
  issue?: Maybe<Issue>;
};

/** Autogenerated input type of ReopenIssue */
export type ReopenIssueInput = {
  /** ID of the issue to be opened. */
  issueId: Scalars['ID']['input'];
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of ReopenIssue. */
export type ReopenIssuePayload = {
  __typename?: 'ReopenIssuePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The issue that was opened. */
  issue?: Maybe<Issue>;
};

/** Autogenerated input type of AddLabelsToLabelable */
export type AddLabelsToLabelableInput = {
  /** The id of the labelable object to add labels to. */
  labelableId: Scalars['ID']['input'];
  /** The ids of the labels to add. */
  labelIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of AddLabelsToLabelable. */
export type AddLabelsToLabelablePayload = {
  __typename?: 'AddLabelsToLabelablePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The item that was labeled. */
  labelable?: Maybe<Labelable>;
};

/** Autogenerated input type of RemoveLabelsFromLabelable */
export type RemoveLabelsFromLabelableInput = {
  /** The id of the Labelable to remove labels from. */
  labelableId: Scalars['ID']['input'];
  /** The ids of labels to remove. */
  labelIds: Array<Scalars['ID']['input']>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of RemoveLabelsFromLabelable. */
export type RemoveLabelsFromLabelablePayload = {
  __typename?: 'RemoveLabelsFromLabelablePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The Labelable the labels were removed from. */
  labelable?: Maybe<Labelable>;
};

/** Autogenerated input type of AddAssigneesToAssignable */
export type AddAssigneesToAssignableInput = {
  /** The id of the assignable object to add assignees to. */
  assignableId: Scalars['ID']['input'];
  /** The ids of actors (users or bots) to add as assignees. Mutually exclusive with `assignees`. */
  assigneeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of AddAssigneesToAssignable. */
export type AddAssigneesToAssignablePayload = {
  __typename?: 'AddAssigneesToAssignablePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The item that was assigned. */
  assignable?: Maybe<Assignable>;
};

/** Autogenerated input type of RemoveAssigneesFromAssignable */
export type RemoveAssigneesFromAssignableInput = {
  /** The id of the assignable object to remove assignees from. */
  assignableId: Scalars['ID']['input'];
  /** The ids of actors to remove as assignees. */
  assigneeIds: Array<Scalars['ID']['input']>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of RemoveAssigneesFromAssignable. */
export type RemoveAssigneesFromAssignablePayload = {
  __typename?: 'RemoveAssigneesFromAssignablePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The item that was unassigned. */
  assignable?: Maybe<Assignable>;
};

/** Autogenerated input type of AddComment */
export type AddCommentInput = {
  /** The Node ID of the subject to modify. */
  subjectId: Scalars['ID']['input'];
  /** The contents of the comment. */
  body: Scalars['String']['input'];
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of AddComment. */
export type AddCommentPayload = {
  __typename?: 'AddCommentPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The edge from the subject's comment connection. */
  commentEdge?: Maybe<IssueCommentEdge>;
  /** The subject */
  subject?: Maybe<Node>;
};

/** The possible state reasons of a closed issue. */
export type IssueClosedStateReason =
  /** An issue that has been closed as completed */
  | 'COMPLETED'
  /** An issue that has been closed as a duplicate */
  | 'DUPLICATE'
  /** An issue that has been closed as not planned */
  | 'NOT_PLANNED';

/** Represents the individual results of a search. */
export type SearchType =
  /** Returns matching discussions in repositories. */
  | 'DISCUSSION'
  /** Returns results matching issues in repositories. */
  | 'ISSUE'
  /** Returns results matching issues in repositories. */
  | 'ISSUE_ADVANCED'
  /** Returns results matching issues using hybrid (lexical + semantic) search. */
  | 'ISSUE_HYBRID'
  /** Returns results matching issues using semantic search. */
  | 'ISSUE_SEMANTIC'
  /** Returns results matching repositories. */
  | 'REPOSITORY'
  /** Returns results matching users and organizations on GitHub. */
  | 'USER';

/** The results of a search. */
export type SearchResultItem = Discussion | Issue | PullRequest | Repository;

/**
 * A list of results that matched against a search query. Regardless of the number
 * of matches, a maximum of 1,000 results will be available across all types,
 * potentially split across many pages.
 */
export type SearchResultItemConnection = {
  __typename?: 'SearchResultItemConnection';
  /**
   * The total number of discussions that matched the search query. Regardless of
   * the total number of matches, a maximum of 1,000 results will be available
   * across all types.
   */
  discussionCount: Scalars['Int']['output'];
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<SearchResultItemEdge>>>;
  /**
   * The total number of issues that matched the search query. Regardless of the
   * total number of matches, a maximum of 1,000 results will be available across all types.
   */
  issueCount: Scalars['Int']['output'];
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<SearchResultItem>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /**
   * The total number of repositories that matched the search query. Regardless of
   * the total number of matches, a maximum of 1,000 results will be available
   * across all types.
   */
  repositoryCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type SearchResultItemEdge = {
  __typename?: 'SearchResultItemEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<SearchResultItem>;
};

/** A repository pull request. */
export type PullRequest = Node & UniformResourceLocatable & {
  __typename?: 'PullRequest';
  /** The Node ID of the PullRequest object */
  id: Scalars['ID']['output'];
  /**
   * Identifies the primary key from the database.
   * @deprecated `databaseId` will be removed because it does not support 64-bit signed integer identifiers. Use `fullDatabaseId` instead. Removal on 2024-07-01 UTC.
   */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** Identifies the pull request number. */
  number: Scalars['Int']['output'];
  /** Identifies the pull request title. */
  title: Scalars['String']['output'];
  /** The body as Markdown. */
  body: Scalars['String']['output'];
  /** Identifies the state of the pull request. */
  state: PullRequestState;
  /** Identifies if the pull request is a draft. */
  isDraft: Scalars['Boolean']['output'];
  /** The HTTP URL for this pull request. */
  url: Scalars['URI']['output'];
  /** The HTTP path for this pull request. */
  resourcePath: Scalars['URI']['output'];
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was closed. */
  closedAt?: Maybe<Scalars['DateTime']['output']>;
  /** The date and time that the pull request was merged. */
  mergedAt?: Maybe<Scalars['DateTime']['output']>;
  /** `true` if the pull request is closed */
  closed: Scalars['Boolean']['output'];
  /** Whether or not the pull request was merged. */
  merged: Scalars['Boolean']['output'];
  /** The actor who authored the comment. */
  author?: Maybe<Actor>;
  /** The repository associated with this node. */
  repository: Repository;
  /** Identifies the name of the head Ref associated with the pull request, even if the ref has been deleted. */
  headRefName: Scalars['String']['output'];
  /** Identifies the oid of the head ref associated with the pull request, even if the ref has been deleted. */
  headRefOid: Scalars['GitObjectID']['output'];
  /** Identifies the name of the base Ref associated with the pull request, even if the ref has been deleted. */
  baseRefName: Scalars['String']['output'];
  /** The repository associated with this pull request's head Ref. */
  headRepository?: Maybe<Repository>;
  /** The owner of the repository associated with this pull request's head Ref. */
  headRepositoryOwner?: Maybe<RepositoryOwner>;
  /** The head and base repositories are different. */
  isCrossRepository: Scalars['Boolean']['output'];
  /** Returns the auto-merge request object if one exists for this pull request. */
  autoMergeRequest?: Maybe<AutoMergeRequest>;
  /** Indicates whether maintainers can modify the pull request. */
  maintainerCanModify: Scalars['Boolean']['output'];
  /** Whether or not the pull request can be merged based on the existence of merge conflicts. */
  mergeable: MergeableState;
  /** Detailed information about the current pull request merge state status. */
  mergeStateStatus: MergeStateStatus;
  /** The current status of this pull request with respect to code review. */
  reviewDecision?: Maybe<PullRequestReviewDecision>;
  /** Identifies the base Ref associated with the pull request. */
  baseRef?: Maybe<Ref>;
  /** The number of additions in this pull request. */
  additions: Scalars['Int']['output'];
  /** The number of deletions in this pull request. */
  deletions: Scalars['Int']['output'];
  /** The number of changed files in this pull request. */
  changedFiles: Scalars['Int']['output'];
  /** The commit that was created when this pull request was merged. */
  mergeCommit?: Maybe<Commit>;
  /** The actor who merged the pull request. */
  mergedBy?: Maybe<Actor>;
  /** Lists the files changed within this pull request. */
  files?: Maybe<PullRequestChangedFileConnection>;
  /** A list of commits present in this pull request's head branch not present in the base branch. */
  commits: PullRequestCommitConnection;
  /** A list of review requests associated with the pull request. */
  reviewRequests?: Maybe<ReviewRequestConnection>;
  /** A list of reviews associated with the pull request. */
  reviews?: Maybe<PullRequestReviewConnection>;
  /** A list of latest reviews per user associated with the pull request that are not also pending review. */
  latestReviews?: Maybe<PullRequestReviewConnection>;
  /**
   * List of project cards associated with this pull request.
   * @deprecated Projects (classic) is being deprecated in favor of the new Projects experience, see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. Removal on 2025-04-01 UTC.
   */
  projectCards: ProjectCardConnection;
  /** A list of Users assigned to this object. */
  assignees: UserConnection;
  /** A list of labels associated with the object. */
  labels?: Maybe<LabelConnection>;
  /** Identifies the milestone associated with the pull request. */
  milestone?: Maybe<Milestone>;
  /** A list of comments associated with the pull request. */
  comments: IssueCommentConnection;
  /** A list of reactions grouped by content left on the subject. */
  reactionGroups?: Maybe<Array<ReactionGroup>>;
  /** List of project items associated with this pull request. */
  projectItems?: Maybe<ProjectV2ItemConnection>;
};


/** A repository pull request. */
export type PullRequestAutoMergeRequestArgs = {
  includeStack?: InputMaybe<Scalars['Boolean']['input']>;
};


/** A repository pull request. */
export type PullRequestFilesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestCommitsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestReviewRequestsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestReviewsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestLatestReviewsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestProjectCardsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestAssigneesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestLabelsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestCommentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A repository pull request. */
export type PullRequestProjectItemsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  includeArchived?: InputMaybe<Scalars['Boolean']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** The possible states of a pull request. */
export type PullRequestState =
  /** A pull request that has been closed without being merged. */
  | 'CLOSED'
  /** A pull request that has been closed by being merged. */
  | 'MERGED'
  /** A pull request that is still open. */
  | 'OPEN';

/** The connection type for PullRequest. */
export type PullRequestConnection = {
  __typename?: 'PullRequestConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<PullRequestEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<PullRequest>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type PullRequestEdge = {
  __typename?: 'PullRequestEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<PullRequest>;
};

/** Ways in which lists of issues can be ordered upon return. */
export type IssueOrder = {
  /** The direction in which to order issues by the specified field. */
  direction: OrderDirection;
  /** The field in which to order issues by. */
  field: IssueOrderField;
};

/** Properties by which issue connections can be ordered. */
export type IssueOrderField =
  /** Order issues by comment count */
  | 'COMMENTS'
  /** Order issues by creation time */
  | 'CREATED_AT'
  /** Order issues by update time */
  | 'UPDATED_AT';

/** Autogenerated input type of CreatePullRequest */
export type CreatePullRequestInput = {
  /**
   * The name of the branch you want your changes pulled into. This should be an existing branch
   * on the current repository. You cannot update the base branch on a pull request to point
   * to another repository.
   */
  baseRefName: Scalars['String']['input'];
  /** The contents of the pull request. */
  body?: InputMaybe<Scalars['String']['input']>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** Indicates whether this pull request should be a draft. */
  draft?: InputMaybe<Scalars['Boolean']['input']>;
  /**
   * The name of the branch where your changes are implemented. For cross-repository pull requests
   * in the same network, namespace `head_ref_name` with a user like this: `username:branch`.
   */
  headRefName: Scalars['String']['input'];
  /** The Node ID of the head repository. */
  headRepositoryId?: InputMaybe<Scalars['ID']['input']>;
  /** Indicates whether maintainers can modify the pull request. */
  maintainerCanModify?: InputMaybe<Scalars['Boolean']['input']>;
  /** The Node ID of the repository. */
  repositoryId: Scalars['ID']['input'];
  /** The title of the pull request. */
  title: Scalars['String']['input'];
};

/** Autogenerated return type of CreatePullRequest. */
export type CreatePullRequestPayload = {
  __typename?: 'CreatePullRequestPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The new pull request. */
  pullRequest?: Maybe<PullRequest>;
};

/** Autogenerated input type of MarkPullRequestReadyForReview */
export type MarkPullRequestReadyForReviewInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** ID of the pull request to be marked as ready for review. */
  pullRequestId: Scalars['ID']['input'];
};

/** Autogenerated return type of MarkPullRequestReadyForReview. */
export type MarkPullRequestReadyForReviewPayload = {
  __typename?: 'MarkPullRequestReadyForReviewPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The pull request that is ready for review. */
  pullRequest?: Maybe<PullRequest>;
};

/** Autogenerated input type of ConvertPullRequestToDraft */
export type ConvertPullRequestToDraftInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** ID of the pull request to convert to draft */
  pullRequestId: Scalars['ID']['input'];
};

/** Autogenerated return type of ConvertPullRequestToDraft. */
export type ConvertPullRequestToDraftPayload = {
  __typename?: 'ConvertPullRequestToDraftPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The pull request that is now a draft. */
  pullRequest?: Maybe<PullRequest>;
};

/** Autogenerated input type of ClosePullRequest */
export type ClosePullRequestInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** ID of the pull request to be closed. */
  pullRequestId: Scalars['ID']['input'];
};

/** Autogenerated return type of ClosePullRequest. */
export type ClosePullRequestPayload = {
  __typename?: 'ClosePullRequestPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The pull request that was closed. */
  pullRequest?: Maybe<PullRequest>;
};

/** Autogenerated input type of ReopenPullRequest */
export type ReopenPullRequestInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** ID of the pull request to be reopened. */
  pullRequestId: Scalars['ID']['input'];
};

/** Autogenerated return type of ReopenPullRequest. */
export type ReopenPullRequestPayload = {
  __typename?: 'ReopenPullRequestPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The pull request that was reopened. */
  pullRequest?: Maybe<PullRequest>;
};

/** The possible target states when updating a pull request. */
export type PullRequestUpdateState =
  /** A pull request that has been closed without being merged. */
  | 'CLOSED'
  /** A pull request that is still open. */
  | 'OPEN';

/** Autogenerated input type of UpdatePullRequest */
export type UpdatePullRequestInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the pull request. */
  pullRequestId: Scalars['ID']['input'];
  /**
   * The name of the branch you want your changes pulled into. This should be an existing branch
   * on the current repository.
   */
  baseRefName?: InputMaybe<Scalars['String']['input']>;
  /** The contents of the pull request. */
  body?: InputMaybe<Scalars['String']['input']>;
  /** The target state of the pull request. */
  state?: InputMaybe<PullRequestUpdateState>;
  /** The title of the pull request. */
  title?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of UpdatePullRequest. */
export type UpdatePullRequestPayload = {
  __typename?: 'UpdatePullRequestPayload';
  /** Identifies the actor who performed the event. */
  actor?: Maybe<Actor>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The updated pull request. */
  pullRequest?: Maybe<PullRequest>;
};

/** Autogenerated input type of MergePullRequest */
export type MergePullRequestInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** ID of the pull request to be merged. */
  pullRequestId: Scalars['ID']['input'];
  /** The merge method to use. If omitted, defaults to 'MERGE' */
  mergeMethod?: InputMaybe<PullRequestMergeMethod>;
  /** Commit headline to use for the merge commit; if omitted, a default message will be used. */
  commitHeadline?: InputMaybe<Scalars['String']['input']>;
  /** Commit body to use for the merge commit; if omitted, a default message will be used */
  commitBody?: InputMaybe<Scalars['String']['input']>;
  /** OID that the pull request head ref must match to allow merge; if omitted, no check is performed. */
  expectedHeadOid?: InputMaybe<Scalars['GitObjectID']['input']>;
};

/** Autogenerated return type of MergePullRequest. */
export type MergePullRequestPayload = {
  __typename?: 'MergePullRequestPayload';
  /** Identifies the actor who performed the event. */
  actor?: Maybe<Actor>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The pull request that was merged. */
  pullRequest?: Maybe<PullRequest>;
};

/** Autogenerated input type of AddPullRequestReview */
export type AddPullRequestReviewInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the pull request to modify. */
  pullRequestId: Scalars['ID']['input'];
  /** The event to perform on the pull request review. */
  event?: InputMaybe<PullRequestReviewEvent>;
  /** The contents of the review body comment. */
  body?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of AddPullRequestReview. */
export type AddPullRequestReviewPayload = {
  __typename?: 'AddPullRequestReviewPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The newly created pull request review. */
  pullRequestReview?: Maybe<PullRequestReview>;
};

/** The possible events to perform on a pull request review. */
export type PullRequestReviewEvent =
  /** Submit feedback and approve merging these changes. */
  | 'APPROVE'
  /** Submit general feedback without explicit approval. */
  | 'COMMENT'
  /** Dismiss review so it now longer effects merging. */
  | 'DISMISS'
  /** Submit feedback that must be addressed before merging. */
  | 'REQUEST_CHANGES';

/** Represents an actor in a Git commit (ie. an author or committer). */
export type GitActor = {
  __typename?: 'GitActor';
  /** The timestamp of the Git action (authoring or committing). */
  date?: Maybe<Scalars['GitTimestamp']['output']>;
  /** The email in the Git commit. */
  email?: Maybe<Scalars['String']['output']>;
  /** The name in the Git commit. */
  name?: Maybe<Scalars['String']['output']>;
  /** The GitHub user corresponding to the email field. Null if no such user exists. */
  user?: Maybe<User>;
};

/** The connection type for GitActor. */
export type GitActorConnection = {
  __typename?: 'GitActorConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<GitActorEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<GitActor>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type GitActorEdge = {
  __typename?: 'GitActorEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<GitActor>;
};

/** A file changed in a pull request. */
export type PullRequestChangedFile = {
  __typename?: 'PullRequestChangedFile';
  /** The number of additions to the file. */
  additions: Scalars['Int']['output'];
  /** How the file was changed in this PullRequest */
  changeType: PatchStatus;
  /** The number of deletions to the file. */
  deletions: Scalars['Int']['output'];
  /** The path of the file. */
  path: Scalars['String']['output'];
  /** The state of the file for the viewer. */
  viewerViewedState: FileViewedState;
};

/** The connection type for PullRequestChangedFile. */
export type PullRequestChangedFileConnection = {
  __typename?: 'PullRequestChangedFileConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<PullRequestChangedFileEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<PullRequestChangedFile>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type PullRequestChangedFileEdge = {
  __typename?: 'PullRequestChangedFileEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<PullRequestChangedFile>;
};

/** The possible types of patch statuses. */
export type PatchStatus =
  /** The file was added. Git status 'A'. */
  | 'ADDED'
  /** The file's type was changed. Git status 'T'. */
  | 'CHANGED'
  /** The file was copied. Git status 'C'. */
  | 'COPIED'
  /** The file was deleted. Git status 'D'. */
  | 'DELETED'
  /** The file's contents were changed. Git status 'M'. */
  | 'MODIFIED'
  /** The file was renamed. Git status 'R'. */
  | 'RENAMED';

/** The possible viewed states of a file . */
export type FileViewedState =
  /** The file has new changes since last viewed. */
  | 'DISMISSED'
  /** The file has not been marked as viewed. */
  | 'UNVIEWED'
  /** The file has been marked as viewed. */
  | 'VIEWED';

/** Represents an auto-merge request for a pull request */
export type AutoMergeRequest = {
  __typename?: 'AutoMergeRequest';
  /** The email address of the author of this auto-merge request. */
  authorEmail?: Maybe<Scalars['String']['output']>;
  /**
   * The commit message of the auto-merge request. If a merge queue is required by
   * the base branch, this value will be set by the merge queue when merging.
   */
  commitBody?: Maybe<Scalars['String']['output']>;
  /**
   * The commit title of the auto-merge request. If a merge queue is required by
   * the base branch, this value will be set by the merge queue when merging
   */
  commitHeadline?: Maybe<Scalars['String']['output']>;
  /**
   * The merge method of the auto-merge request. If a merge queue is required by
   * the base branch, this value will be set by the merge queue when merging.
   */
  mergeMethod: PullRequestMergeMethod;
  /** When was this auto-merge request was enabled. */
  enabledAt?: Maybe<Scalars['DateTime']['output']>;
  /** The actor who created the auto-merge request. */
  enabledBy?: Maybe<Actor>;
};

/** Represents available types of methods to use when merging a pull request. */
export type PullRequestMergeMethod =
  /** Add all commits from the head branch to the base branch with a merge commit. */
  | 'MERGE'
  /** Add all commits from the head branch onto the base branch individually. */
  | 'REBASE'
  /** Combine all commits from the head branch into a single commit in the base branch. */
  | 'SQUASH';

/** Whether or not a PullRequest can be merged. */
export type MergeableState =
  /** The pull request cannot be merged due to merge conflicts. */
  | 'CONFLICTING'
  /** The pull request can be merged. */
  | 'MERGEABLE'
  /** The mergeability of the pull request is still being calculated. */
  | 'UNKNOWN';

/** Detailed status information about a pull request merge. */
export type MergeStateStatus =
  /** The head ref is out of date. */
  | 'BEHIND'
  /** The merge is blocked. */
  | 'BLOCKED'
  /** Mergeable and passing commit status. */
  | 'CLEAN'
  /** The merge commit cannot be cleanly created. */
  | 'DIRTY'
  /** The merge is blocked due to the pull request being a draft. */
  | 'DRAFT'
  /** Mergeable with passing commit status and pre-receive hooks. */
  | 'HAS_HOOKS'
  /** The state cannot currently be determined. */
  | 'UNKNOWN'
  /** Mergeable with non-passing commit status. */
  | 'UNSTABLE';

/** The review status of a pull request. */
export type PullRequestReviewDecision =
  /** The pull request has received an approving review. */
  | 'APPROVED'
  /** Changes have been requested on the pull request. */
  | 'CHANGES_REQUESTED'
  /** A review is required before the pull request can be merged. */
  | 'REVIEW_REQUIRED';

/** Represents a Git commit part of a pull request. */
export type PullRequestCommit = {
  __typename?: 'PullRequestCommit';
  /** The Git commit object */
  commit: Commit;
};

/** The connection type for PullRequestCommit. */
export type PullRequestCommitConnection = {
  __typename?: 'PullRequestCommitConnection';
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<PullRequestCommit>>>;
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<PullRequestCommitEdge>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type PullRequestCommitEdge = {
  __typename?: 'PullRequestCommitEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<PullRequestCommit>;
};

/** A request for a user to review a pull request. */
export type ReviewRequest = {
  __typename?: 'ReviewRequest';
  /** The reviewer that is requested. */
  requestedReviewer?: Maybe<RequestedReviewer>;
};

/** Types that can be requested reviewers. */
export type RequestedReviewer = Bot | Team | User;

/** The connection type for ReviewRequest. */
export type ReviewRequestConnection = {
  __typename?: 'ReviewRequestConnection';
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<ReviewRequest>>>;
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<ReviewRequestEdge>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type ReviewRequestEdge = {
  __typename?: 'ReviewRequestEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<ReviewRequest>;
};

/** A special type of user which takes actions on behalf of GitHub Apps. */
export type Bot = {
  __typename?: 'Bot';
  /** The username of the actor. */
  login: Scalars['String']['output'];
};

/** A review object for a given pull request. */
export type PullRequestReview = Node & {
  __typename?: 'PullRequestReview';
  /** The Node ID of the PullRequestReview object */
  id: Scalars['ID']['output'];
  /** The actor who authored the comment. */
  author?: Maybe<Actor>;
  /** Author's association with the subject of the comment. */
  authorAssociation: CommentAuthorAssociation;
  /** Identifies when the Pull Request Review was submitted */
  submittedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Identifies the pull request review body. */
  body: Scalars['String']['output'];
  /** Identifies the current state of the pull request review. */
  state: PullRequestReviewState;
  /** Identifies the commit associated with this pull request review. */
  commit?: Maybe<Commit>;
  /** A list of reactions grouped by content left on the subject. */
  reactionGroups?: Maybe<Array<ReactionGroup>>;
};

/** The possible states of a pull request review. */
export type PullRequestReviewState =
  /** A review allowing the pull request to merge. */
  | 'APPROVED'
  /** A review blocking the pull request from merging. */
  | 'CHANGES_REQUESTED'
  /** An informational review. */
  | 'COMMENTED'
  /** A review that has been dismissed. */
  | 'DISMISSED'
  /** A review that has not yet been submitted. */
  | 'PENDING';

/** A comment author association with repository. */
export type CommentAuthorAssociation =
  /** Author has been invited to collaborate on the repository. */
  | 'COLLABORATOR'
  /** Author has previously committed to the repository. */
  | 'CONTRIBUTOR'
  /** Author has not previously committed to GitHub. */
  | 'FIRST_TIMER'
  /** Author has not previously committed to the repository. */
  | 'FIRST_TIME_CONTRIBUTOR'
  /** Author is a placeholder for an unclaimed user. */
  | 'MANNEQUIN'
  /** Author is a member of the organization that owns the repository. */
  | 'MEMBER'
  /** Author has no association with the repository. */
  | 'NONE'
  /** Author is the owner of the repository. */
  | 'OWNER';

/** The connection type for PullRequestReview. */
export type PullRequestReviewConnection = {
  __typename?: 'PullRequestReviewConnection';
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<PullRequestReview>>>;
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<PullRequestReviewEdge>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type PullRequestReviewEdge = {
  __typename?: 'PullRequestReviewEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<PullRequestReview>;
};

/** A list of users. */
export type UserConnection = {
  __typename?: 'UserConnection';
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<User>>>;
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<UserEdge>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** Represents a user. */
export type UserEdge = {
  __typename?: 'UserEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<User>;
};

/** A label for categorizing Issues, Pull Requests, Milestones, or Discussions with a given Repository. */
export type Label = Node & {
  __typename?: 'Label';
  /** The Node ID of the Label object */
  id: Scalars['ID']['output'];
  /** Identifies the label name. */
  name: Scalars['String']['output'];
  /** A brief description of this label. */
  description?: Maybe<Scalars['String']['output']>;
  /** Identifies the label color. */
  color: Scalars['String']['output'];
};

/** The connection type for Label. */
export type LabelConnection = {
  __typename?: 'LabelConnection';
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Label>>>;
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<LabelEdge>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type LabelEdge = {
  __typename?: 'LabelEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Label>;
};

/** Represents a comment on an Issue. */
export type IssueComment = Node & {
  __typename?: 'IssueComment';
  /** The Node ID of the IssueComment object */
  id: Scalars['ID']['output'];
  /** The actor who authored the comment. */
  author?: Maybe<Actor>;
  /** Author's association with the subject of the comment. */
  authorAssociation: CommentAuthorAssociation;
  /** The body as Markdown. */
  body: Scalars['String']['output'];
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Check if this comment was edited and includes an edit with the creation data */
  includesCreatedEdit: Scalars['Boolean']['output'];
  /** Returns whether or not a comment has been minimized. */
  isMinimized: Scalars['Boolean']['output'];
  /**
   * Returns why the comment was minimized. One of `abuse`, `off-topic`,
   * `outdated`, `resolved`, `duplicate`, `spam`, and `low-quality`. Note that the
   * case and formatting of these values differs from the inputs to the
   * `MinimizeComment` mutation.
   */
  minimizedReason?: Maybe<Scalars['String']['output']>;
  /** A list of reactions grouped by content left on the subject. */
  reactionGroups?: Maybe<Array<ReactionGroup>>;
  /** The HTTP URL for this issue comment */
  url: Scalars['URI']['output'];
  /** Did the viewer author this comment. */
  viewerDidAuthor: Scalars['Boolean']['output'];
};

/** The connection type for IssueComment. */
export type IssueCommentConnection = {
  __typename?: 'IssueCommentConnection';
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<IssueComment>>>;
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<IssueCommentEdge>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type IssueCommentEdge = {
  __typename?: 'IssueCommentEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<IssueComment>;
};

/** A group of emoji reactions to a particular piece of content. */
export type ReactionGroup = {
  __typename?: 'ReactionGroup';
  /** Identifies the emoji reaction. */
  content: ReactionContent;
  /**
   * Users who have reacted to the reaction subject with the emotion represented by this reaction group
   * @deprecated Reactors can now be mannequins, bots, and organizations. Use the `reactors` field instead. Removal on 2021-10-01 UTC.
   */
  users: ReactingUserConnection;
};

/** Emojis that can be attached to Issues, Pull Requests and Comments. */
export type ReactionContent =
  /** Represents the `:confused:` emoji. */
  | 'CONFUSED'
  /** Represents the `:eyes:` emoji. */
  | 'EYES'
  /** Represents the `:heart:` emoji. */
  | 'HEART'
  /** Represents the `:hooray:` emoji. */
  | 'HOORAY'
  /** Represents the `:laugh:` emoji. */
  | 'LAUGH'
  /** Represents the `:rocket:` emoji. */
  | 'ROCKET'
  /** Represents the `:-1:` emoji. */
  | 'THUMBS_DOWN'
  /** Represents the `:+1:` emoji. */
  | 'THUMBS_UP';

/** Represents the rollup for both the check runs and status for a commit. */
export type StatusCheckRollup = {
  __typename?: 'StatusCheckRollup';
  /** A list of status contexts and check runs for this commit. */
  contexts: StatusCheckRollupContextConnection;
};


/** Represents the rollup for both the check runs and status for a commit. */
export type StatusCheckRollupContextsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** Types that can be inside a StatusCheckRollup context. */
export type StatusCheckRollupContext = CheckRun | StatusContext;

/** The connection type for StatusCheckRollupContext. */
export type StatusCheckRollupContextConnection = {
  __typename?: 'StatusCheckRollupContextConnection';
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<StatusCheckRollupContext>>>;
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<StatusCheckRollupContextEdge>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type StatusCheckRollupContextEdge = {
  __typename?: 'StatusCheckRollupContextEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<StatusCheckRollupContext>;
};

/** Represents an individual commit status context */
export type StatusContext = {
  __typename?: 'StatusContext';
  /** The name of this status context. */
  context: Scalars['String']['output'];
  /** The state of this status context. */
  state: StatusState;
  /** The URL for this status context. */
  targetUrl?: Maybe<Scalars['URI']['output']>;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** The description for this status context. */
  description?: Maybe<Scalars['String']['output']>;
};

/** The possible commit status states. */
export type StatusState =
  /** Status is errored. */
  | 'ERROR'
  /** Status is expected. */
  | 'EXPECTED'
  /** Status is failing. */
  | 'FAILURE'
  /** Status is pending. */
  | 'PENDING'
  /** Status is successful. */
  | 'SUCCESS';

/** A check run. */
export type CheckRun = {
  __typename?: 'CheckRun';
  /** The name of the check for this check run. */
  name: Scalars['String']['output'];
  /** The check suite that this run is a part of. */
  checkSuite: CheckSuite;
  /** The current status of the check run. */
  status: CheckStatusState;
  /** The conclusion of the check run. */
  conclusion?: Maybe<CheckConclusionState>;
  /** Identifies the date and time when the check run was started. */
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Identifies the date and time when the check run was completed. */
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  /** The URL from which to find full details of the check run on the integrator's site. */
  detailsUrl?: Maybe<Scalars['URI']['output']>;
};

/** The possible states for a check suite or run status. */
export type CheckStatusState =
  /** The check suite or run has been completed. */
  | 'COMPLETED'
  /** The check suite or run is in progress. */
  | 'IN_PROGRESS'
  /** The check suite or run is in pending state. */
  | 'PENDING'
  /** The check suite or run has been queued. */
  | 'QUEUED'
  /** The check suite or run has been requested. */
  | 'REQUESTED'
  /** The check suite or run is in waiting state. */
  | 'WAITING';

/** The possible states for a check suite or run conclusion. */
export type CheckConclusionState =
  /** The check suite or run requires action. */
  | 'ACTION_REQUIRED'
  /** The check suite or run has been cancelled. */
  | 'CANCELLED'
  /** The check suite or run has failed. */
  | 'FAILURE'
  /** The check suite or run was neutral. */
  | 'NEUTRAL'
  /** The check suite or run was skipped. */
  | 'SKIPPED'
  /** The check suite or run was marked stale by GitHub. Only GitHub can use this conclusion. */
  | 'STALE'
  /** The check suite or run has failed at startup. */
  | 'STARTUP_FAILURE'
  /** The check suite or run has succeeded. */
  | 'SUCCESS'
  /** The check suite or run has timed out. */
  | 'TIMED_OUT';

/** A check suite. */
export type CheckSuite = {
  __typename?: 'CheckSuite';
  /** The workflow run associated with this check suite. */
  workflowRun?: Maybe<WorkflowRun>;
};

/** A workflow run. */
export type WorkflowRun = {
  __typename?: 'WorkflowRun';
  /** The workflow executed in this workflow run. */
  workflow: Workflow;
};

/** A workflow contains meta information about an Actions workflow file. */
export type Workflow = {
  __typename?: 'Workflow';
  /** The name of the workflow. */
  name: Scalars['String']['output'];
};

/** The connection type for User. */
export type ReactingUserConnection = {
  __typename?: 'ReactingUserConnection';
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** New projects that manage issues, pull requests and drafts using tables and boards. */
export type ProjectV2 = Node & {
  __typename?: 'ProjectV2';
  /** The Node ID of the ProjectV2 object */
  id: Scalars['ID']['output'];
  /** The project's number. */
  number: Scalars['Int']['output'];
  /** The project's name. */
  title: Scalars['String']['output'];
  /** The project's short description. */
  shortDescription?: Maybe<Scalars['String']['output']>;
  /** The project's readme. */
  readme?: Maybe<Scalars['String']['output']>;
  /** Returns true if the project is public. */
  public: Scalars['Boolean']['output'];
  /** Returns true if the project is closed. */
  closed: Scalars['Boolean']['output'];
  /** The HTTP URL for this project */
  url: Scalars['URI']['output'];
  /** The HTTP path for this project */
  resourcePath: Scalars['URI']['output'];
  /** The project's owner. Currently limited to organizations and users. */
  owner: ProjectV2Owner;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was closed. */
  closedAt?: Maybe<Scalars['DateTime']['output']>;
  /** List of items in the project */
  items: ProjectV2ItemConnection;
  /** List of fields and their constraints in the project */
  fields: ProjectV2FieldConfigurationConnection;
};


/** New projects that manage issues, pull requests and drafts using tables and boards. */
export type ProjectV2ItemsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  archivedStates?: InputMaybe<Array<ProjectV2ItemArchivedState>>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ProjectV2ItemOrder>;
  query?: InputMaybe<Scalars['String']['input']>;
};


/** New projects that manage issues, pull requests and drafts using tables and boards. */
export type ProjectV2FieldsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ProjectV2FieldOrder>;
};

/** Represents an owner of a project. */
export type ProjectV2Owner = {
  /** The Node ID of the ProjectV2Owner object */
  id: Scalars['ID']['output'];
  /** Find a project by number. */
  projectV2?: Maybe<ProjectV2>;
  /** A list of projects under the owner. */
  projectsV2: ProjectV2Connection;
};


/** Represents an owner of a project. */
export type ProjectV2OwnerProjectV2Args = {
  number: Scalars['Int']['input'];
};


/** Represents an owner of a project. */
export type ProjectV2OwnerProjectsV2Args = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  minPermissionLevel?: InputMaybe<ProjectV2PermissionLevel>;
  orderBy?: InputMaybe<ProjectV2Order>;
  query?: InputMaybe<Scalars['String']['input']>;
};

/** The connection type for ProjectV2. */
export type ProjectV2Connection = {
  __typename?: 'ProjectV2Connection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<ProjectV2Edge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<ProjectV2>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type ProjectV2Edge = {
  __typename?: 'ProjectV2Edge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<ProjectV2>;
};

/** Ways in which lists of projects can be ordered upon return. */
export type ProjectV2Order = {
  /** The direction in which to order projects by the specified field. */
  direction: OrderDirection;
  /** The field in which to order projects by. */
  field: ProjectV2OrderField;
};

/** Properties by which projects can be ordered. */
export type ProjectV2OrderField =
  /** The project's date and time of creation */
  | 'CREATED_AT'
  /** The project's number */
  | 'NUMBER'
  /** The project's title */
  | 'TITLE'
  /** The project's date and time of update */
  | 'UPDATED_AT';

/** The possible roles of a collaborator on a project. */
export type ProjectV2PermissionLevel =
  /** The collaborator can view, edit, and maange the settings of the project */
  | 'ADMIN'
  /** The collaborator can view the project */
  | 'READ'
  /** The collaborator can view and edit the project */
  | 'WRITE';

/** Ordering options for project v2 field connections */
export type ProjectV2FieldOrder = {
  /** The ordering direction. */
  direction: OrderDirection;
  /** The field to order the project v2 fields by. */
  field: ProjectV2FieldOrderField;
};

/** Properties by which project v2 field connections can be ordered. */
export type ProjectV2FieldOrderField =
  /** Order project v2 fields by creation time */
  | 'CREATED_AT'
  /** Order project v2 fields by name */
  | 'NAME'
  /** Order project v2 fields by position */
  | 'POSITION';

/** Ordering options for project v2 item connections */
export type ProjectV2ItemOrder = {
  /** The ordering direction. */
  direction: OrderDirection;
  /** The field to order the project v2 items by. */
  field: ProjectV2ItemOrderField;
};

/** Properties by which project v2 item connections can be ordered. */
export type ProjectV2ItemOrderField =
  /** Order project v2 items by the their position in the project */
  | 'POSITION';

/** Ordering options for project v2 item field value connections */
export type ProjectV2ItemFieldValueOrder = {
  /** The ordering direction. */
  direction: OrderDirection;
  /** The field to order the project v2 item field values by. */
  field: ProjectV2ItemFieldValueOrderField;
};

/** Properties by which project v2 item field value connections can be ordered. */
export type ProjectV2ItemFieldValueOrderField =
  /** Order project v2 item field values by the their position in the project */
  | 'POSITION';

/** The possible archived states of a `ProjectV2Item`. */
export type ProjectV2ItemArchivedState =
  /** A project item that is archived */
  | 'ARCHIVED'
  /** A project item that is not archived */
  | 'NOT_ARCHIVED';

/** Common fields across different project field types */
export type ProjectV2FieldCommon = {
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** The field's type. */
  dataType: ProjectV2FieldType;
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The Node ID of the ProjectV2FieldCommon object */
  id: Scalars['ID']['output'];
  /** Returns true if this field is associated with an issue field */
  isIssueField: Scalars['Boolean']['output'];
  /** The project field's name. */
  name: Scalars['String']['output'];
  /** The project that contains this field. */
  project: ProjectV2;
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};

/** A field inside a project. */
export type ProjectV2Field = Node & ProjectV2FieldCommon & {
  __typename?: 'ProjectV2Field';
  /** The Node ID of the ProjectV2Field object */
  id: Scalars['ID']['output'];
  /** The project field's name. */
  name: Scalars['String']['output'];
  /** The field's type. */
  dataType: ProjectV2FieldType;
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** Returns true if this field is associated with an issue field */
  isIssueField: Scalars['Boolean']['output'];
  /** The project that contains this field. */
  project: ProjectV2;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};

/** A single select field inside a project. */
export type ProjectV2SingleSelectField = Node & ProjectV2FieldCommon & {
  __typename?: 'ProjectV2SingleSelectField';
  /** The Node ID of the ProjectV2SingleSelectField object */
  id: Scalars['ID']['output'];
  /** The project field's name. */
  name: Scalars['String']['output'];
  /** The field's type. */
  dataType: ProjectV2FieldType;
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** Returns true if this field is associated with an issue field */
  isIssueField: Scalars['Boolean']['output'];
  /** Options for the single select field */
  options: Array<ProjectV2SingleSelectFieldOption>;
  /** The project that contains this field. */
  project: ProjectV2;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};


/** A single select field inside a project. */
export type ProjectV2SingleSelectFieldOptionsArgs = {
  names?: InputMaybe<Array<Scalars['String']['input']>>;
};

/** Configurations for project fields. */
export type ProjectV2FieldConfiguration = ProjectV2Field | ProjectV2IterationField | ProjectV2SingleSelectField;

/** The connection type for ProjectV2FieldConfiguration. */
export type ProjectV2FieldConfigurationConnection = {
  __typename?: 'ProjectV2FieldConfigurationConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<ProjectV2FieldConfigurationEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<ProjectV2FieldConfiguration>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type ProjectV2FieldConfigurationEdge = {
  __typename?: 'ProjectV2FieldConfigurationEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<ProjectV2FieldConfiguration>;
};

/** Single select field option for a configuration for a project. */
export type ProjectV2SingleSelectFieldOption = {
  __typename?: 'ProjectV2SingleSelectFieldOption';
  /** The option's display color. */
  color: ProjectV2SingleSelectFieldOptionColor;
  /** The option's plain-text description. */
  description: Scalars['String']['output'];
  /** The option's description, possibly containing HTML. */
  descriptionHTML: Scalars['String']['output'];
  /** The option's ID. */
  id: Scalars['String']['output'];
  /** The option's name. */
  name: Scalars['String']['output'];
  /** The option's html name. */
  nameHTML: Scalars['String']['output'];
};

/** The display color of a single-select field option. */
export type ProjectV2SingleSelectFieldOptionColor =
  /** BLUE */
  | 'BLUE'
  /** GRAY */
  | 'GRAY'
  /** GREEN */
  | 'GREEN'
  /** ORANGE */
  | 'ORANGE'
  /** PINK */
  | 'PINK'
  /** PURPLE */
  | 'PURPLE'
  /** RED */
  | 'RED'
  /** YELLOW */
  | 'YELLOW';

/** The type of a project field. */
export type ProjectV2FieldType =
  /** Assignees */
  | 'ASSIGNEES'
  /** Closed */
  | 'CLOSED'
  /** Created */
  | 'CREATED'
  /** Date */
  | 'DATE'
  /** Issue type */
  | 'ISSUE_TYPE'
  /** Iteration */
  | 'ITERATION'
  /** Labels */
  | 'LABELS'
  /** Linked Pull Requests */
  | 'LINKED_PULL_REQUESTS'
  /** Milestone */
  | 'MILESTONE'
  /** Multi Select */
  | 'MULTI_SELECT'
  /** Number */
  | 'NUMBER'
  /** Parent issue */
  | 'PARENT_ISSUE'
  /** Repository */
  | 'REPOSITORY'
  /** Reviewers */
  | 'REVIEWERS'
  /** Single Select */
  | 'SINGLE_SELECT'
  /** Sub-issues progress */
  | 'SUB_ISSUES_PROGRESS'
  /** Text */
  | 'TEXT'
  /** Title */
  | 'TITLE'
  /** Tracked by */
  | 'TRACKED_BY'
  /** Tracks */
  | 'TRACKS'
  /** Updated */
  | 'UPDATED';

/** An item within a Project. */
export type ProjectV2Item = Node & {
  __typename?: 'ProjectV2Item';
  /** The Node ID of the ProjectV2Item object */
  id: Scalars['ID']['output'];
  /** The project that contains this item. */
  project: ProjectV2;
  /** The content of the referenced draft issue, issue, pull request */
  content?: Maybe<ProjectV2ItemContent>;
  /** The type of the item. */
  type: ProjectV2ItemType;
  /** Whether the item is archived. */
  isArchived: Scalars['Boolean']['output'];
  /** The field values that are set on the item. */
  fieldValues: ProjectV2ItemFieldValueConnection;
  /** The field value of the first project field which matches the 'name' argument that is set on the item. */
  fieldValueByName?: Maybe<ProjectV2ItemFieldValue>;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};


/** An item within a Project. */
export type ProjectV2ItemFieldValuesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ProjectV2ItemFieldValueOrder>;
};


/** An item within a Project. */
export type ProjectV2ItemFieldValueByNameArgs = {
  name: Scalars['String']['input'];
};

/** The connection type for ProjectV2Item. */
export type ProjectV2ItemConnection = {
  __typename?: 'ProjectV2ItemConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<ProjectV2ItemEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<ProjectV2Item>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type ProjectV2ItemEdge = {
  __typename?: 'ProjectV2ItemEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<ProjectV2Item>;
};

/** Types that can be inside Project Items. */
export type ProjectV2ItemContent = DraftIssue | Issue | PullRequest;

/** The type of a project item. */
export type ProjectV2ItemType =
  /** Draft Issue */
  | 'DRAFT_ISSUE'
  /** Issue */
  | 'ISSUE'
  /** Pull Request */
  | 'PULL_REQUEST'
  /** Redacted Item */
  | 'REDACTED';

/** A draft issue within a project. */
export type DraftIssue = Node & {
  __typename?: 'DraftIssue';
  /** The Node ID of the DraftIssue object */
  id: Scalars['ID']['output'];
  /** The title of the draft issue */
  title: Scalars['String']['output'];
  /** The body of the draft issue. */
  body: Scalars['String']['output'];
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};

/** Project field values */
export type ProjectV2ItemFieldValue = ProjectV2ItemFieldDateValue | ProjectV2ItemFieldIterationValue | ProjectV2ItemFieldLabelValue | ProjectV2ItemFieldMilestoneValue | ProjectV2ItemFieldNumberValue | ProjectV2ItemFieldPullRequestValue | ProjectV2ItemFieldRepositoryValue | ProjectV2ItemFieldReviewerValue | ProjectV2ItemFieldSingleSelectValue | ProjectV2ItemFieldTextValue | ProjectV2ItemFieldUserValue;

/** The connection type for ProjectV2ItemFieldValue. */
export type ProjectV2ItemFieldValueConnection = {
  __typename?: 'ProjectV2ItemFieldValueConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<ProjectV2ItemFieldValueEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<ProjectV2ItemFieldValue>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type ProjectV2ItemFieldValueEdge = {
  __typename?: 'ProjectV2ItemFieldValueEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<ProjectV2ItemFieldValue>;
};

/** The value of a text field in a Project item. */
export type ProjectV2ItemFieldTextValue = Node & {
  __typename?: 'ProjectV2ItemFieldTextValue';
  /** The Node ID of the ProjectV2ItemFieldTextValue object */
  id: Scalars['ID']['output'];
  /** The project field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** Text value of a field */
  text?: Maybe<Scalars['String']['output']>;
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};

/** The value of a number field in a Project item. */
export type ProjectV2ItemFieldNumberValue = Node & {
  __typename?: 'ProjectV2ItemFieldNumberValue';
  /** The Node ID of the ProjectV2ItemFieldNumberValue object */
  id: Scalars['ID']['output'];
  /** The project field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** Number as a float(8) */
  number?: Maybe<Scalars['Float']['output']>;
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};

/** The value of a date field in a Project item. */
export type ProjectV2ItemFieldDateValue = Node & {
  __typename?: 'ProjectV2ItemFieldDateValue';
  /** The Node ID of the ProjectV2ItemFieldDateValue object */
  id: Scalars['ID']['output'];
  /** The project field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** Date value for the field */
  date?: Maybe<Scalars['Date']['output']>;
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};

/** The value of a single select field in a Project item. */
export type ProjectV2ItemFieldSingleSelectValue = Node & {
  __typename?: 'ProjectV2ItemFieldSingleSelectValue';
  /** The Node ID of the ProjectV2ItemFieldSingleSelectValue object */
  id: Scalars['ID']['output'];
  /** The project field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** The name of the selected single select option. */
  name?: Maybe<Scalars['String']['output']>;
  /** The id of the selected single select option. */
  optionId?: Maybe<Scalars['String']['output']>;
  /** The color applied to the selected single-select option. */
  color: ProjectV2SingleSelectFieldOptionColor;
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};

/** Autogenerated input type of CreateProjectV2 */
export type CreateProjectV2Input = {
  /** The owner ID to create the project under. */
  ownerId: Scalars['ID']['input'];
  /** The repository to link the project to. */
  repositoryId?: InputMaybe<Scalars['ID']['input']>;
  /** The title of the project. */
  title: Scalars['String']['input'];
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of CreateProjectV2. */
export type CreateProjectV2Payload = {
  __typename?: 'CreateProjectV2Payload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The new project. */
  projectV2?: Maybe<ProjectV2>;
};

/** Autogenerated input type of AddProjectV2ItemById */
export type AddProjectV2ItemByIdInput = {
  /** The id of the Issue or Pull Request to add. */
  contentId: Scalars['ID']['input'];
  /** The ID of the Project to add the item to. */
  projectId: Scalars['ID']['input'];
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of AddProjectV2ItemById. */
export type AddProjectV2ItemByIdPayload = {
  __typename?: 'AddProjectV2ItemByIdPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The item added to the project. */
  item?: Maybe<ProjectV2Item>;
};

/** Autogenerated input type of AddProjectV2DraftIssue */
export type AddProjectV2DraftIssueInput = {
  /** The ID of the Project to add the draft issue to. */
  projectId: Scalars['ID']['input'];
  /**
   * The title of the draft issue. A project item can also be created by providing
   * the URL of an Issue or Pull Request if you have access.
   */
  title: Scalars['String']['input'];
  /** The body of the draft issue. */
  body?: InputMaybe<Scalars['String']['input']>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of AddProjectV2DraftIssue. */
export type AddProjectV2DraftIssuePayload = {
  __typename?: 'AddProjectV2DraftIssuePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The draft issue added to the project. */
  projectItem?: Maybe<ProjectV2Item>;
};

/** Autogenerated input type of UpdateProjectV2DraftIssue */
export type UpdateProjectV2DraftIssueInput = {
  /** The ID of the draft issue to update. */
  draftIssueId: Scalars['ID']['input'];
  /** The title of the draft issue. */
  title?: InputMaybe<Scalars['String']['input']>;
  /** The body of the draft issue. */
  body?: InputMaybe<Scalars['String']['input']>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of UpdateProjectV2DraftIssue. */
export type UpdateProjectV2DraftIssuePayload = {
  __typename?: 'UpdateProjectV2DraftIssuePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The draft issue updated in the project. */
  draftIssue?: Maybe<DraftIssue>;
};

/** Autogenerated input type of UpdateProjectV2ItemFieldValue */
export type UpdateProjectV2ItemFieldValueInput = {
  /** The ID of the Project. */
  projectId: Scalars['ID']['input'];
  /** The ID of the item to be updated. */
  itemId: Scalars['ID']['input'];
  /** The ID of the field to be updated. */
  fieldId: Scalars['ID']['input'];
  /** The value which will be set on the field. */
  value: ProjectV2FieldValue;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of UpdateProjectV2ItemFieldValue. */
export type UpdateProjectV2ItemFieldValuePayload = {
  __typename?: 'UpdateProjectV2ItemFieldValuePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The updated item. */
  projectV2Item?: Maybe<ProjectV2Item>;
};

/** Autogenerated input type of ClearProjectV2ItemFieldValue */
export type ClearProjectV2ItemFieldValueInput = {
  /** The ID of the Project. */
  projectId: Scalars['ID']['input'];
  /** The ID of the item to be cleared. */
  itemId: Scalars['ID']['input'];
  /** The ID of the field to be cleared. */
  fieldId: Scalars['ID']['input'];
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of ClearProjectV2ItemFieldValue. */
export type ClearProjectV2ItemFieldValuePayload = {
  __typename?: 'ClearProjectV2ItemFieldValuePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The updated item. */
  projectV2Item?: Maybe<ProjectV2Item>;
};

/** Autogenerated input type of CreateProjectV2Field */
export type CreateProjectV2FieldInput = {
  /** The ID of the Project to create the field in. */
  projectId: Scalars['ID']['input'];
  /** The name of the field. */
  name: Scalars['String']['input'];
  /** The data type of the field. */
  dataType: ProjectV2CustomFieldType;
  /** Options for a single select field. At least one value is required if data_type is SINGLE_SELECT */
  singleSelectOptions?: InputMaybe<Array<ProjectV2SingleSelectFieldOptionInput>>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of CreateProjectV2Field. */
export type CreateProjectV2FieldPayload = {
  __typename?: 'CreateProjectV2FieldPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The new field. */
  projectV2Field?: Maybe<ProjectV2FieldConfiguration>;
};

/** The type of a project field. */
export type ProjectV2CustomFieldType =
  /** Date */
  | 'DATE'
  /** Iteration */
  | 'ITERATION'
  /** Multi Select */
  | 'MULTI_SELECT'
  /** Number */
  | 'NUMBER'
  /** Single Select */
  | 'SINGLE_SELECT'
  /** Text */
  | 'TEXT';

/** The values that can be used to update a field of an item inside a Project. Only 1 value can be updated at a time. */
export type ProjectV2FieldValue = {
  /** The ISO 8601 date to set on the field. */
  date?: InputMaybe<Scalars['Date']['input']>;
  /** The number to set on the field. */
  number?: InputMaybe<Scalars['Float']['input']>;
  /** The id of the single select option to set on the field. */
  singleSelectOptionId?: InputMaybe<Scalars['String']['input']>;
  /** The text to set on the field. */
  text?: InputMaybe<Scalars['String']['input']>;
};

/** Represents a single select field option */
export type ProjectV2SingleSelectFieldOptionInput = {
  /** The display color of the option */
  color: ProjectV2SingleSelectFieldOptionColor;
  /** The description text of the option */
  description: Scalars['String']['input'];
  /**
   * The ID of an existing single select option. Include this to preserve the
   * option's identity during updates, preventing item field values from being cleared.
   */
  id?: InputMaybe<Scalars['String']['input']>;
  /** The name of the option */
  name: Scalars['String']['input'];
};

/** An iteration field inside a project. */
export type ProjectV2IterationField = {
  __typename?: 'ProjectV2IterationField';
  /** The Node ID of the ProjectV2IterationField object */
  id: Scalars['ID']['output'];
  /** The project field's name. */
  name: Scalars['String']['output'];
  /** The field's type. */
  dataType: ProjectV2FieldType;
};

/** The value of an iteration field in a Project item. */
export type ProjectV2ItemFieldIterationValue = Node & {
  __typename?: 'ProjectV2ItemFieldIterationValue';
  /** The Node ID of the ProjectV2ItemFieldIterationValue object */
  id: Scalars['ID']['output'];
  /** The project field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** The ID of the iteration. */
  iterationId: Scalars['String']['output'];
  /** The title of the iteration. */
  title: Scalars['String']['output'];
  /** The start date of the iteration. */
  startDate: Scalars['Date']['output'];
  /** The duration of the iteration in days. */
  duration: Scalars['Int']['output'];
};

/** The value of the labels field in a Project item. */
export type ProjectV2ItemFieldLabelValue = {
  __typename?: 'ProjectV2ItemFieldLabelValue';
  /** The field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** Labels value of a field */
  labels?: Maybe<LabelConnection>;
};


/** The value of the labels field in a Project item. */
export type ProjectV2ItemFieldLabelValueLabelsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** The value of a milestone field in a Project item. */
export type ProjectV2ItemFieldMilestoneValue = {
  __typename?: 'ProjectV2ItemFieldMilestoneValue';
  /** The field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** Milestone value of a field */
  milestone?: Maybe<Milestone>;
};

/** The value of a pull request field in a Project item. */
export type ProjectV2ItemFieldPullRequestValue = {
  __typename?: 'ProjectV2ItemFieldPullRequestValue';
  /** The field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** The pull requests for this field */
  pullRequests?: Maybe<PullRequestConnection>;
};


/** The value of a pull request field in a Project item. */
export type ProjectV2ItemFieldPullRequestValuePullRequestsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<PullRequestOrder>;
};

/** The value of a repository field in a Project item. */
export type ProjectV2ItemFieldRepositoryValue = {
  __typename?: 'ProjectV2ItemFieldRepositoryValue';
  /** The field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** The repository for this field. */
  repository?: Maybe<Repository>;
};

/** The value of a reviewers field in a Project item. */
export type ProjectV2ItemFieldReviewerValue = {
  __typename?: 'ProjectV2ItemFieldReviewerValue';
  /** The field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** The reviewers for this field. */
  reviewers?: Maybe<RequestedReviewerConnection>;
};


/** The value of a reviewers field in a Project item. */
export type ProjectV2ItemFieldReviewerValueReviewersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** The value of a user field in a Project item. */
export type ProjectV2ItemFieldUserValue = {
  __typename?: 'ProjectV2ItemFieldUserValue';
  /** The field that contains this value. */
  field: ProjectV2FieldConfiguration;
  /** The users for this field */
  users?: Maybe<UserConnection>;
};


/** The value of a user field in a Project item. */
export type ProjectV2ItemFieldUserValueUsersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** The connection type for RequestedReviewer. */
export type RequestedReviewerConnection = {
  __typename?: 'RequestedReviewerConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<RequestedReviewerEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<RequestedReviewer>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** Ways in which lists of issues can be ordered upon return. */
export type PullRequestOrder = {
  /** The direction in which to order pull requests by the specified field. */
  direction: OrderDirection;
  /** The field in which to order pull requests by. */
  field: PullRequestOrderField;
};

/** An edge in a connection. */
export type RequestedReviewerEdge = {
  __typename?: 'RequestedReviewerEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<RequestedReviewer>;
};

/** Properties by which pull_requests connections can be ordered. */
export type PullRequestOrderField =
  /** Order pull_requests by creation time */
  | 'CREATED_AT'
  /** Order pull_requests by update time */
  | 'UPDATED_AT';

/** A discussion in a repository. */
export type Discussion = Labelable & Node & Votable & {
  __typename?: 'Discussion';
  /** The comment chosen as this discussion's answer, if any. */
  answer?: Maybe<DiscussionComment>;
  /** The time when a user chose this discussion's answer, if answered. */
  answerChosenAt?: Maybe<Scalars['DateTime']['output']>;
  /** The user who chose this discussion's answer, if answered. */
  answerChosenBy?: Maybe<Actor>;
  /** The actor who authored the discussion. */
  author?: Maybe<Actor>;
  /** Author's association with the subject of the comment. */
  authorAssociation: CommentAuthorAssociation;
  /** The main text of the discussion post. */
  body: Scalars['String']['output'];
  /** The category for this discussion. */
  category: DiscussionCategory;
  /** Indicates if the object is closed (definition of closed may depend on type) */
  closed: Scalars['Boolean']['output'];
  /** Identifies the date and time when the object was closed. */
  closedAt?: Maybe<Scalars['DateTime']['output']>;
  /** The replies to the discussion. */
  comments: DiscussionCommentConnection;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Check if this comment was created via an email reply. */
  createdViaEmail: Scalars['Boolean']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The Node ID of the Discussion object */
  id: Scalars['ID']['output'];
  /** Check if this comment was edited and includes an edit with the creation data */
  includesCreatedEdit: Scalars['Boolean']['output'];
  /** Only return answered/unanswered discussions */
  isAnswered?: Maybe<Scalars['Boolean']['output']>;
  /** A list of labels associated with the object. */
  labels?: Maybe<LabelConnection>;
  /** The moment the editor made the last edit */
  lastEditedAt?: Maybe<Scalars['DateTime']['output']>;
  /** `true` if the object is locked */
  locked: Scalars['Boolean']['output'];
  /** The number identifying this discussion within the repository. */
  number: Scalars['Int']['output'];
  /** Identifies when the comment was published at. */
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  /** A list of reactions grouped by content left on the subject. */
  reactionGroups?: Maybe<Array<ReactionGroup>>;
  /** The repository associated with this node. */
  repository: Repository;
  /** The path for this discussion. */
  resourcePath: Scalars['URI']['output'];
  /** Identifies the reason for the discussion's state. */
  stateReason?: Maybe<DiscussionStateReason>;
  /** The title of this discussion. */
  title: Scalars['String']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** Number of upvotes that this subject has received. */
  upvoteCount: Scalars['Int']['output'];
  /** The URL for this discussion. */
  url: Scalars['URI']['output'];
  /** Indicates if the object can be closed by the viewer. */
  viewerCanClose: Scalars['Boolean']['output'];
  /** Check if the current viewer can delete this object. */
  viewerCanDelete: Scalars['Boolean']['output'];
  /** Indicates if the viewer can edit labels for this object. */
  viewerCanLabel: Scalars['Boolean']['output'];
  /** Can user react to this subject */
  viewerCanReact: Scalars['Boolean']['output'];
  /** Indicates if the object can be reopened by the viewer. */
  viewerCanReopen: Scalars['Boolean']['output'];
  /** Check if the viewer is able to change their subscription status for the repository. */
  viewerCanSubscribe: Scalars['Boolean']['output'];
  /** Check if the current viewer can update this object. */
  viewerCanUpdate: Scalars['Boolean']['output'];
  /** Whether or not the current user can add or remove an upvote on this subject. */
  viewerCanUpvote: Scalars['Boolean']['output'];
  /** Did the viewer author this comment. */
  viewerDidAuthor: Scalars['Boolean']['output'];
  /** Whether or not the current user has already upvoted this subject. */
  viewerHasUpvoted: Scalars['Boolean']['output'];
};


/** A discussion in a repository. */
export type DiscussionCommentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A discussion in a repository. */
export type DiscussionLabelsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** A category for discussions in a repository. */
export type DiscussionCategory = Node & {
  __typename?: 'DiscussionCategory';
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** A description of this category. */
  description?: Maybe<Scalars['String']['output']>;
  /** An emoji representing this category. */
  emoji: Scalars['String']['output'];
  /** The Node ID of the DiscussionCategory object */
  id: Scalars['ID']['output'];
  /** Whether or not discussions in this category support choosing an answer with the markDiscussionCommentAsAnswer mutation. */
  isAnswerable: Scalars['Boolean']['output'];
  /** The name of this category. */
  name: Scalars['String']['output'];
  /** The repository associated with this node. */
  repository: Repository;
  /** The slug of this category. */
  slug: Scalars['String']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
};

/** A comment on a discussion. */
export type DiscussionComment = Node & Votable & {
  __typename?: 'DiscussionComment';
  /** The actor who authored the comment. */
  author?: Maybe<Actor>;
  /** Author's association with the subject of the comment. */
  authorAssociation: CommentAuthorAssociation;
  /** The body as Markdown. */
  body: Scalars['String']['output'];
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Check if this comment was created via an email reply. */
  createdViaEmail: Scalars['Boolean']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The discussion this comment was created in */
  discussion?: Maybe<Discussion>;
  /** The Node ID of the DiscussionComment object */
  id: Scalars['ID']['output'];
  /** Check if this comment was edited and includes an edit with the creation data */
  includesCreatedEdit: Scalars['Boolean']['output'];
  /** Has this comment been chosen as the answer of its discussion? */
  isAnswer: Scalars['Boolean']['output'];
  /** Returns whether or not a comment has been minimized. */
  isMinimized: Scalars['Boolean']['output'];
  /** The moment the editor made the last edit */
  lastEditedAt?: Maybe<Scalars['DateTime']['output']>;
  /**
   * Returns why the comment was minimized. One of `abuse`, `off-topic`,
   * `outdated`, `resolved`, `duplicate`, `spam`, and `low-quality`. Note that the
   * case and formatting of these values differs from the inputs to the
   * `MinimizeComment` mutation.
   */
  minimizedReason?: Maybe<Scalars['String']['output']>;
  /** Identifies when the comment was published at. */
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  /** A list of reactions grouped by content left on the subject. */
  reactionGroups?: Maybe<Array<ReactionGroup>>;
  /** The threaded replies to this comment. */
  replies: DiscussionCommentConnection;
  /** The discussion comment this comment is a reply to */
  replyTo?: Maybe<DiscussionComment>;
  /** The path for this discussion comment. */
  resourcePath: Scalars['URI']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** Number of upvotes that this subject has received. */
  upvoteCount: Scalars['Int']['output'];
  /** The URL for this discussion comment. */
  url: Scalars['URI']['output'];
  /** Check if the current viewer can delete this object. */
  viewerCanDelete: Scalars['Boolean']['output'];
  /** Can the current user mark this comment as an answer? */
  viewerCanMarkAsAnswer: Scalars['Boolean']['output'];
  /** Check if the current viewer can minimize this object. */
  viewerCanMinimize: Scalars['Boolean']['output'];
  /** Can user react to this subject */
  viewerCanReact: Scalars['Boolean']['output'];
  /** Can the current user unmark this comment as an answer? */
  viewerCanUnmarkAsAnswer: Scalars['Boolean']['output'];
  /** Check if the current viewer can update this object. */
  viewerCanUpdate: Scalars['Boolean']['output'];
  /** Whether or not the current user can add or remove an upvote on this subject. */
  viewerCanUpvote: Scalars['Boolean']['output'];
  /** Did the viewer author this comment. */
  viewerDidAuthor: Scalars['Boolean']['output'];
  /** Whether or not the current user has already upvoted this subject. */
  viewerHasUpvoted: Scalars['Boolean']['output'];
};


/** A comment on a discussion. */
export type DiscussionCommentRepliesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** The connection type for Discussion. */
export type DiscussionConnection = {
  __typename?: 'DiscussionConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<DiscussionEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Discussion>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type DiscussionEdge = {
  __typename?: 'DiscussionEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Discussion>;
};

/** The connection type for DiscussionCategory. */
export type DiscussionCategoryConnection = {
  __typename?: 'DiscussionCategoryConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<DiscussionCategoryEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<DiscussionCategory>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type DiscussionCategoryEdge = {
  __typename?: 'DiscussionCategoryEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<DiscussionCategory>;
};

/** The connection type for DiscussionComment. */
export type DiscussionCommentConnection = {
  __typename?: 'DiscussionCommentConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<DiscussionCommentEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<DiscussionComment>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type DiscussionCommentEdge = {
  __typename?: 'DiscussionCommentEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<DiscussionComment>;
};

/** Ways in which lists of discussions can be ordered upon return. */
export type DiscussionOrder = {
  /** The direction in which to order discussions by the specified field. */
  direction: OrderDirection;
  /** The field by which to order discussions. */
  field: DiscussionOrderField;
};

/** Properties by which discussion connections can be ordered. */
export type DiscussionOrderField =
  /** Order discussions by creation time. */
  | 'CREATED_AT'
  /** Order discussions by most recent modification time. */
  | 'UPDATED_AT';

/** The possible states of a discussion. */
export type DiscussionState =
  /** A discussion that has been closed */
  | 'CLOSED'
  /** A discussion that is open */
  | 'OPEN';

/** The possible state reasons of a discussion. */
export type DiscussionStateReason =
  /** The discussion is a duplicate of another */
  | 'DUPLICATE'
  /** The discussion is no longer relevant */
  | 'OUTDATED'
  /** The discussion was reopened */
  | 'REOPENED'
  /** The discussion has been resolved */
  | 'RESOLVED';

/** The possible reasons for closing a discussion. */
export type DiscussionCloseReason =
  /** The discussion is a duplicate of another */
  | 'DUPLICATE'
  /** The discussion is no longer relevant */
  | 'OUTDATED'
  /** The discussion has been resolved */
  | 'RESOLVED';

/** A subject that may be upvoted. */
export type Votable = {
  /** Number of upvotes that this subject has received. */
  upvoteCount: Scalars['Int']['output'];
  /** Whether or not the current user can add or remove an upvote on this subject. */
  viewerCanUpvote: Scalars['Boolean']['output'];
  /** Whether or not the current user has already upvoted this subject. */
  viewerHasUpvoted: Scalars['Boolean']['output'];
};

/** Autogenerated input type of CreateDiscussion */
export type CreateDiscussionInput = {
  /** The body of the discussion. */
  body: Scalars['String']['input'];
  /** The id of the discussion category to associate with this discussion. */
  categoryId: Scalars['ID']['input'];
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The id of the repository on which to create the discussion. */
  repositoryId: Scalars['ID']['input'];
  /** The title of the discussion. */
  title: Scalars['String']['input'];
};

/** Autogenerated return type of CreateDiscussion. */
export type CreateDiscussionPayload = {
  __typename?: 'CreateDiscussionPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The discussion that was just created. */
  discussion?: Maybe<Discussion>;
};

/** Autogenerated input type of AddDiscussionComment */
export type AddDiscussionCommentInput = {
  /** The contents of the comment. */
  body: Scalars['String']['input'];
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the discussion to comment on. */
  discussionId: Scalars['ID']['input'];
  /** The Node ID of the discussion comment within this discussion to reply to. */
  replyToId?: InputMaybe<Scalars['ID']['input']>;
};

/** Autogenerated return type of AddDiscussionComment. */
export type AddDiscussionCommentPayload = {
  __typename?: 'AddDiscussionCommentPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The newly created discussion comment. */
  comment?: Maybe<DiscussionComment>;
};

/** Autogenerated input type of MarkDiscussionCommentAsAnswer */
export type MarkDiscussionCommentAsAnswerInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the discussion comment to mark as an answer. */
  id: Scalars['ID']['input'];
};

/** Autogenerated return type of MarkDiscussionCommentAsAnswer. */
export type MarkDiscussionCommentAsAnswerPayload = {
  __typename?: 'MarkDiscussionCommentAsAnswerPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The discussion that includes the chosen comment. */
  discussion?: Maybe<Discussion>;
};

/** Autogenerated input type of UnmarkDiscussionCommentAsAnswer */
export type UnmarkDiscussionCommentAsAnswerInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the discussion comment to unmark as an answer. */
  id: Scalars['ID']['input'];
};

/** Autogenerated return type of UnmarkDiscussionCommentAsAnswer. */
export type UnmarkDiscussionCommentAsAnswerPayload = {
  __typename?: 'UnmarkDiscussionCommentAsAnswerPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The discussion that includes the comment. */
  discussion?: Maybe<Discussion>;
};

/** Autogenerated input type of AddUpvote */
export type AddUpvoteInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the discussion or comment to upvote. */
  subjectId: Scalars['ID']['input'];
};

/** Autogenerated return type of AddUpvote. */
export type AddUpvotePayload = {
  __typename?: 'AddUpvotePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The votable subject. */
  subject?: Maybe<Votable>;
};

/** Autogenerated input type of RemoveUpvote */
export type RemoveUpvoteInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the discussion or comment to remove upvote. */
  subjectId: Scalars['ID']['input'];
};

/** Autogenerated return type of RemoveUpvote. */
export type RemoveUpvotePayload = {
  __typename?: 'RemoveUpvotePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The votable subject. */
  subject?: Maybe<Votable>;
};

/** Autogenerated input type of CloseDiscussion */
export type CloseDiscussionInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** ID of the discussion to be closed. */
  discussionId: Scalars['ID']['input'];
  /** The reason why the discussion is being closed. */
  reason?: InputMaybe<DiscussionCloseReason>;
};

/** Autogenerated return type of CloseDiscussion. */
export type CloseDiscussionPayload = {
  __typename?: 'CloseDiscussionPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The discussion that was closed. */
  discussion?: Maybe<Discussion>;
};

/** Autogenerated input type of ReopenDiscussion */
export type ReopenDiscussionInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** ID of the discussion to be reopened. */
  discussionId: Scalars['ID']['input'];
};

/** Autogenerated return type of ReopenDiscussion. */
export type ReopenDiscussionPayload = {
  __typename?: 'ReopenDiscussionPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The discussion that was reopened. */
  discussion?: Maybe<Discussion>;
};

/** Autogenerated input type of UpdateDiscussion */
export type UpdateDiscussionInput = {
  /** The new contents of the discussion body. */
  body?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of a discussion category within the same repository to change this discussion to. */
  categoryId?: InputMaybe<Scalars['ID']['input']>;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the discussion to update. */
  discussionId: Scalars['ID']['input'];
  /** The new discussion title. */
  title?: InputMaybe<Scalars['String']['input']>;
};

/** Autogenerated return type of UpdateDiscussion. */
export type UpdateDiscussionPayload = {
  __typename?: 'UpdateDiscussionPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The modified discussion. */
  discussion?: Maybe<Discussion>;
};

/** Autogenerated input type of DeleteDiscussion */
export type DeleteDiscussionInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The id of the discussion to delete. */
  id: Scalars['ID']['input'];
};

/** Autogenerated return type of DeleteDiscussion. */
export type DeleteDiscussionPayload = {
  __typename?: 'DeleteDiscussionPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The discussion that was just deleted. */
  discussion?: Maybe<Discussion>;
};

/** Autogenerated input type of UpdateDiscussionComment */
export type UpdateDiscussionCommentInput = {
  /** The new contents of the comment body. */
  body: Scalars['String']['input'];
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node ID of the discussion comment to update. */
  commentId: Scalars['ID']['input'];
};

/** Autogenerated return type of UpdateDiscussionComment. */
export type UpdateDiscussionCommentPayload = {
  __typename?: 'UpdateDiscussionCommentPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The modified discussion comment. */
  comment?: Maybe<DiscussionComment>;
};

/** Autogenerated input type of DeleteDiscussionComment */
export type DeleteDiscussionCommentInput = {
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  /** The Node id of the discussion comment to delete. */
  id: Scalars['ID']['input'];
};

/** Autogenerated return type of DeleteDiscussionComment. */
export type DeleteDiscussionCommentPayload = {
  __typename?: 'DeleteDiscussionCommentPayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  /** The discussion comment that was just deleted. */
  comment?: Maybe<DiscussionComment>;
};

/** A Gist. */
export type Gist = Node & Starrable & UniformResourceLocatable & {
  __typename?: 'Gist';
  /** A list of comments associated with the gist */
  comments: GistCommentConnection;
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** The gist description. */
  description?: Maybe<Scalars['String']['output']>;
  /** The files in this gist. */
  files?: Maybe<Array<Maybe<GistFile>>>;
  /** A list of forks associated with the gist */
  forks: GistConnection;
  /** The Node ID of the Gist object */
  id: Scalars['ID']['output'];
  /** Identifies if the gist is a fork. */
  isFork: Scalars['Boolean']['output'];
  /** Whether the gist is public or not. */
  isPublic: Scalars['Boolean']['output'];
  /** The gist name. */
  name: Scalars['String']['output'];
  /** The gist owner. */
  owner?: Maybe<RepositoryOwner>;
  /** Identifies when the gist was last pushed to. */
  pushedAt?: Maybe<Scalars['DateTime']['output']>;
  /** The HTML path to this resource. */
  resourcePath: Scalars['URI']['output'];
  /** Returns a count of how many stargazers there are on this object */
  stargazerCount: Scalars['Int']['output'];
  /** A list of users who have starred this starrable. */
  stargazers: StargazerConnection;
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** The HTTP URL for this Gist. */
  url: Scalars['URI']['output'];
  /** Returns a boolean indicating whether the viewing user has starred this starrable. */
  viewerHasStarred: Scalars['Boolean']['output'];
};


/** A Gist. */
export type GistCommentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** A Gist. */
export type GistFilesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  oid?: InputMaybe<Scalars['GitObjectID']['input']>;
};


/** A Gist. */
export type GistForksArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<GistOrder>;
};


/** A Gist. */
export type GistStargazersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<StarOrder>;
};

/** A file in a gist. */
export type GistFile = {
  __typename?: 'GistFile';
  /** The file name encoded to remove characters that are invalid in URL paths. */
  encodedName?: Maybe<Scalars['String']['output']>;
  /** The file extension from the file name. */
  extension?: Maybe<Scalars['String']['output']>;
  /** Indicates if this file is an image. */
  isImage: Scalars['Boolean']['output'];
  /** Whether the file's contents were truncated. */
  isTruncated: Scalars['Boolean']['output'];
  /** The programming language this file is written in. */
  language?: Maybe<Language>;
  /** The gist file name. */
  name?: Maybe<Scalars['String']['output']>;
  /** The gist file size in bytes. */
  size?: Maybe<Scalars['Int']['output']>;
  /** UTF8 text data or null if the file is binary */
  text?: Maybe<Scalars['String']['output']>;
};


/** A file in a gist. */
export type GistFileTextArgs = {
  truncate?: InputMaybe<Scalars['Int']['input']>;
};

/** Represents a comment on an Gist. */
export type GistComment = Node & {
  __typename?: 'GistComment';
  /** The actor who authored the comment. */
  author?: Maybe<Actor>;
  /** Identifies the comment body. */
  body: Scalars['String']['output'];
  /** The body rendered to text. */
  bodyText: Scalars['String']['output'];
  /** Identifies the date and time when the object was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Identifies the primary key from the database. */
  databaseId?: Maybe<Scalars['Int']['output']>;
  /** The associated gist. */
  gist: Gist;
  /** The Node ID of the GistComment object */
  id: Scalars['ID']['output'];
  /** Check if this comment was edited and includes an edit with the creation data */
  includesCreatedEdit: Scalars['Boolean']['output'];
  /** Identifies the date and time when the object was last updated. */
  updatedAt: Scalars['DateTime']['output'];
  /** Check if the current viewer can delete this object. */
  viewerCanDelete: Scalars['Boolean']['output'];
  /** Check if the current viewer can update this object. */
  viewerCanUpdate: Scalars['Boolean']['output'];
  /** Did the viewer author this comment. */
  viewerDidAuthor: Scalars['Boolean']['output'];
};

/** The connection type for Gist. */
export type GistConnection = {
  __typename?: 'GistConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<GistEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<Gist>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type GistEdge = {
  __typename?: 'GistEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<Gist>;
};

/** The connection type for GistComment. */
export type GistCommentConnection = {
  __typename?: 'GistCommentConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<GistCommentEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<GistComment>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** An edge in a connection. */
export type GistCommentEdge = {
  __typename?: 'GistCommentEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge. */
  node?: Maybe<GistComment>;
};

/** Ordering options for gist connections */
export type GistOrder = {
  /** The ordering direction. */
  direction: OrderDirection;
  /** The field to order repositories by. */
  field: GistOrderField;
};

/** Properties by which gist connections can be ordered. */
export type GistOrderField =
  /** Order gists by creation time */
  | 'CREATED_AT'
  /** Order gists by push time */
  | 'PUSHED_AT'
  /** Order gists by update time */
  | 'UPDATED_AT';

/** The privacy of a Gist */
export type GistPrivacy =
  /** Gists that are public and secret */
  | 'ALL'
  /** Public */
  | 'PUBLIC'
  /** Secret */
  | 'SECRET';

/** Represents a given language found in repositories. */
export type Language = Node & {
  __typename?: 'Language';
  /** The Node ID of the Language object */
  id: Scalars['ID']['output'];
  /** The name of the current language. */
  name: Scalars['String']['output'];
};

/** The connection type for User. */
export type StargazerConnection = {
  __typename?: 'StargazerConnection';
  /** A list of edges. */
  edges?: Maybe<Array<Maybe<StargazerEdge>>>;
  /** A list of nodes. */
  nodes?: Maybe<Array<Maybe<User>>>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
  /** Identifies the total count of items in the connection. */
  totalCount: Scalars['Int']['output'];
};

/** Represents a user that's starred a repository. */
export type StargazerEdge = {
  __typename?: 'StargazerEdge';
  /** A cursor for use in pagination. */
  cursor: Scalars['String']['output'];
  node: User;
  /** Identifies when the item was starred. */
  starredAt: Scalars['DateTime']['output'];
};

/** Ways in which star connections can be ordered. */
export type StarOrder = {
  /** The direction in which to order nodes. */
  direction: OrderDirection;
  /** The field in which to order nodes by. */
  field: StarOrderField;
};

/** Properties by which star connections can be ordered. */
export type StarOrderField =
  /** Allows ordering a list of stars by when they were created. */
  | 'STARRED_AT';



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;



/** Mapping of union types */
export type ResolversUnionTypes<_RefType extends Record<string, unknown>> = {
  IssueOrPullRequest:
    | ( IssueNode )
    | ( PullRequestNode )
  ;
  SearchResultItem:
    | ( DiscussionNode )
    | ( IssueNode )
    | ( PullRequestNode )
    | ( RepositoryNode )
  ;
  RequestedReviewer:
    | ( Bot )
    | ( TeamNode )
    | ( UserNode )
  ;
  StatusCheckRollupContext:
    | ( CheckRun )
    | ( StatusContext )
  ;
  ProjectV2FieldConfiguration:
    | ( ProjectFieldNode )
    | ( ProjectV2IterationField )
    | ( ProjectFieldNode )
  ;
  ProjectV2ItemContent:
    | ( DraftIssueNode )
    | ( IssueNode )
    | ( PullRequestNode )
  ;
  ProjectV2ItemFieldValue:
    | ( ProjectFieldValueNode )
    | ( Omit<ProjectV2ItemFieldIterationValue, 'field'> & { field: _RefType['ProjectV2FieldConfiguration'] } )
    | ( Omit<ProjectV2ItemFieldLabelValue, 'field'> & { field: _RefType['ProjectV2FieldConfiguration'] } )
    | ( Omit<ProjectV2ItemFieldMilestoneValue, 'field'> & { field: _RefType['ProjectV2FieldConfiguration'] } )
    | ( ProjectFieldValueNode )
    | ( Omit<ProjectV2ItemFieldPullRequestValue, 'field' | 'pullRequests'> & { field: _RefType['ProjectV2FieldConfiguration'], pullRequests?: Maybe<_RefType['PullRequestConnection']> } )
    | ( Omit<ProjectV2ItemFieldRepositoryValue, 'field' | 'repository'> & { field: _RefType['ProjectV2FieldConfiguration'], repository?: Maybe<_RefType['Repository']> } )
    | ( Omit<ProjectV2ItemFieldReviewerValue, 'field' | 'reviewers'> & { field: _RefType['ProjectV2FieldConfiguration'], reviewers?: Maybe<_RefType['RequestedReviewerConnection']> } )
    | ( ProjectFieldValueNode )
    | ( ProjectFieldValueNode )
    | ( Omit<ProjectV2ItemFieldUserValue, 'field' | 'users'> & { field: _RefType['ProjectV2FieldConfiguration'], users?: Maybe<_RefType['UserConnection']> } )
  ;
};

/** Mapping of interface types */
export type ResolversInterfaceTypes<_RefType extends Record<string, unknown>> = {
  Node:
    | ( UserNode )
    | ( RepositoryNode )
    | ( RefNode )
    | ( CommitNode )
    | ( ReleaseNode )
    | ( ReleaseAssetNode )
    | ( OrganizationNode )
    | ( TeamNode )
    | ( IssueNode )
    | ( Milestone )
    | ( IssueType )
    | ( PullRequestNode )
    | ( ReviewNode )
    | ( Label )
    | ( CommentNode )
    | ( ProjectNode )
    | ( ProjectFieldNode )
    | ( ProjectFieldNode )
    | ( ProjectItemNode )
    | ( DraftIssueNode )
    | ( ProjectFieldValueNode )
    | ( ProjectFieldValueNode )
    | ( ProjectFieldValueNode )
    | ( ProjectFieldValueNode )
    | ( Omit<ProjectV2ItemFieldIterationValue, 'field'> & { field: _RefType['ProjectV2FieldConfiguration'] } )
    | ( DiscussionNode )
    | ( DiscussionCategoryNode )
    | ( DiscussionCommentNode )
    | ( GistNode )
    | ( GistCommentNode )
    | ( LanguageNode )
  ;
  UniformResourceLocatable:
    | ( UserNode )
    | ( RepositoryNode )
    | ( ReleaseNode )
    | ( OrganizationNode )
    | ( IssueNode )
    | ( PullRequestNode )
    | ( GistNode )
  ;
  Actor:
    | ( UserNode )
    | ( OrganizationNode )
  ;
  RepositoryOwner:
    | ( UserNode )
    | ( OrganizationNode )
  ;
  RepositoryInfo: ( RepositoryNode );
  Starrable:
    | ( RepositoryNode )
    | ( GistNode )
  ;
  GitObject: ( CommitNode );
  GitSignature:
    | ( GitSignatureNode )
    | ( GitSignatureNode )
  ;
  Labelable:
    | ( IssueNode )
    | ( DiscussionNode )
  ;
  Assignable: ( IssueNode );
  ProjectV2Owner:
    | ( UserNode )
    | ( OrganizationNode )
  ;
  ProjectV2FieldCommon:
    | ( ProjectFieldNode )
    | ( ProjectFieldNode )
  ;
  Votable:
    | ( DiscussionNode )
    | ( DiscussionCommentNode )
  ;
};

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Node: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Node']>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  RateLimit: ResolverTypeWrapper<RateLimitInfo>;
  UniformResourceLocatable: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['UniformResourceLocatable']>;
  Actor: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Actor']>;
  User: ResolverTypeWrapper<UserNode>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  URI: ResolverTypeWrapper<Scalars['URI']['output']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RepositoryOwner: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['RepositoryOwner']>;
  RepositoryInfo: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['RepositoryInfo']>;
  Starrable: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Starrable']>;
  Repository: ResolverTypeWrapper<RepositoryNode>;
  RepositoryConnection: ResolverTypeWrapper<Omit<RepositoryConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['RepositoryEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['Repository']>>> }>;
  RepositoryEdge: ResolverTypeWrapper<Omit<RepositoryEdge, 'node'> & { node?: Maybe<ResolversTypes['Repository']> }>;
  Ref: ResolverTypeWrapper<RefNode>;
  BranchProtectionRule: ResolverTypeWrapper<BranchProtectionRule>;
  GitObject: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['GitObject']>;
  Commit: ResolverTypeWrapper<CommitNode>;
  Blame: ResolverTypeWrapper<Omit<Blame, 'ranges'> & { ranges: Array<ResolversTypes['BlameRange']> }>;
  BlameRange: ResolverTypeWrapper<Omit<BlameRange, 'commit'> & { commit: ResolversTypes['Commit'] }>;
  GitObjectID: ResolverTypeWrapper<Scalars['GitObjectID']['output']>;
  RepositoryOrder: RepositoryOrder;
  RepositoryOrderField: RepositoryOrderField;
  OrderDirection: OrderDirection;
  RepositoryPrivacy: RepositoryPrivacy;
  RepositoryAffiliation: RepositoryAffiliation;
  RepositoryPermission: RepositoryPermission;
  RepositoryVisibility: RepositoryVisibility;
  CreateRepositoryInput: CreateRepositoryInput;
  CreateRepositoryPayload: ResolverTypeWrapper<Omit<CreateRepositoryPayload, 'repository'> & { repository?: Maybe<ResolversTypes['Repository']> }>;
  UpdateRepositoryInput: UpdateRepositoryInput;
  UpdateRepositoryPayload: ResolverTypeWrapper<Omit<UpdateRepositoryPayload, 'repository'> & { repository?: Maybe<ResolversTypes['Repository']> }>;
  CreateLabelInput: CreateLabelInput;
  CreateLabelPayload: ResolverTypeWrapper<CreateLabelPayload>;
  UpdateLabelInput: UpdateLabelInput;
  UpdateLabelPayload: ResolverTypeWrapper<UpdateLabelPayload>;
  DeleteLabelInput: DeleteLabelInput;
  DeleteLabelPayload: ResolverTypeWrapper<DeleteLabelPayload>;
  LabelOrder: LabelOrder;
  LabelOrderField: LabelOrderField;
  GitSSHRemote: ResolverTypeWrapper<Scalars['GitSSHRemote']['output']>;
  Release: ResolverTypeWrapper<ReleaseNode>;
  ReleaseAsset: ResolverTypeWrapper<ReleaseAssetNode>;
  ReleaseConnection: ResolverTypeWrapper<Omit<ReleaseConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['ReleaseEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['Release']>>> }>;
  ReleaseEdge: ResolverTypeWrapper<Omit<ReleaseEdge, 'node'> & { node?: Maybe<ResolversTypes['Release']> }>;
  ReleaseAssetConnection: ResolverTypeWrapper<Omit<ReleaseAssetConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['ReleaseAssetEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['ReleaseAsset']>>> }>;
  ReleaseAssetEdge: ResolverTypeWrapper<Omit<ReleaseAssetEdge, 'node'> & { node?: Maybe<ResolversTypes['ReleaseAsset']> }>;
  ReleaseOrder: ReleaseOrder;
  ReleaseOrderField: ReleaseOrderField;
  IssueTemplate: ResolverTypeWrapper<IssueTemplateNode>;
  PullRequestTemplate: ResolverTypeWrapper<Omit<PullRequestTemplate, 'repository'> & { repository: ResolversTypes['Repository'] }>;
  GitSignature: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['GitSignature']>;
  GitSignatureState: GitSignatureState;
  GpgSignature: ResolverTypeWrapper<GitSignatureNode>;
  SshSignature: ResolverTypeWrapper<GitSignatureNode>;
  Organization: ResolverTypeWrapper<OrganizationNode>;
  OrganizationConnection: ResolverTypeWrapper<Omit<OrganizationConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['OrganizationEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['Organization']>>> }>;
  OrganizationEdge: ResolverTypeWrapper<Omit<OrganizationEdge, 'node'> & { node?: Maybe<ResolversTypes['Organization']> }>;
  Team: ResolverTypeWrapper<TeamNode>;
  TeamConnection: ResolverTypeWrapper<Omit<TeamConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['TeamEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['Team']>>> }>;
  TeamEdge: ResolverTypeWrapper<Omit<TeamEdge, 'node'> & { node?: Maybe<ResolversTypes['Team']> }>;
  TeamMemberConnection: ResolverTypeWrapper<Omit<TeamMemberConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['TeamMemberEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['User']>>> }>;
  TeamMemberEdge: ResolverTypeWrapper<TeamMemberEdgeNode>;
  TeamMemberRole: TeamMemberRole;
  TeamRepositoryConnection: ResolverTypeWrapper<Omit<TeamRepositoryConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['TeamRepositoryEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['Repository']>>> }>;
  TeamRepositoryEdge: ResolverTypeWrapper<TeamRepositoryEdgeNode>;
  TeamPrivacy: TeamPrivacy;
  TeamNotificationSetting: TeamNotificationSetting;
  Issue: ResolverTypeWrapper<IssueNode>;
  IssueOrPullRequest: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['IssueOrPullRequest']>;
  Milestone: ResolverTypeWrapper<Milestone>;
  MilestoneConnection: ResolverTypeWrapper<MilestoneConnection>;
  MilestoneEdge: ResolverTypeWrapper<MilestoneEdge>;
  MilestoneState: MilestoneState;
  MilestoneOrder: MilestoneOrder;
  MilestoneOrderField: MilestoneOrderField;
  ProjectCardConnection: ResolverTypeWrapper<ProjectCardConnection>;
  ProjectCardEdge: ResolverTypeWrapper<ProjectCardEdge>;
  ProjectCard: ResolverTypeWrapper<ProjectCard>;
  Project: ResolverTypeWrapper<Project>;
  ProjectColumn: ResolverTypeWrapper<ProjectColumn>;
  IssueConnection: ResolverTypeWrapper<Omit<IssueConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['IssueEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['Issue']>>> }>;
  IssueEdge: ResolverTypeWrapper<Omit<IssueEdge, 'node'> & { node?: Maybe<ResolversTypes['Issue']> }>;
  IssueState: IssueState;
  IssueStateReason: IssueStateReason;
  IssueFilters: IssueFilters;
  IssueTypeColor: IssueTypeColor;
  IssueType: ResolverTypeWrapper<IssueType>;
  SubIssuesSummary: ResolverTypeWrapper<SubIssuesSummary>;
  Labelable: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Labelable']>;
  Assignable: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Assignable']>;
  CreateIssueInput: CreateIssueInput;
  CreateIssuePayload: ResolverTypeWrapper<Omit<CreateIssuePayload, 'issue'> & { issue?: Maybe<ResolversTypes['Issue']> }>;
  UpdateIssueInput: UpdateIssueInput;
  UpdateIssuePayload: ResolverTypeWrapper<Omit<UpdateIssuePayload, 'issue'> & { issue?: Maybe<ResolversTypes['Issue']> }>;
  CloseIssueInput: CloseIssueInput;
  CloseIssuePayload: ResolverTypeWrapper<Omit<CloseIssuePayload, 'issue'> & { issue?: Maybe<ResolversTypes['Issue']> }>;
  ReopenIssueInput: ReopenIssueInput;
  ReopenIssuePayload: ResolverTypeWrapper<Omit<ReopenIssuePayload, 'issue'> & { issue?: Maybe<ResolversTypes['Issue']> }>;
  AddLabelsToLabelableInput: AddLabelsToLabelableInput;
  AddLabelsToLabelablePayload: ResolverTypeWrapper<Omit<AddLabelsToLabelablePayload, 'labelable'> & { labelable?: Maybe<ResolversTypes['Labelable']> }>;
  RemoveLabelsFromLabelableInput: RemoveLabelsFromLabelableInput;
  RemoveLabelsFromLabelablePayload: ResolverTypeWrapper<Omit<RemoveLabelsFromLabelablePayload, 'labelable'> & { labelable?: Maybe<ResolversTypes['Labelable']> }>;
  AddAssigneesToAssignableInput: AddAssigneesToAssignableInput;
  AddAssigneesToAssignablePayload: ResolverTypeWrapper<Omit<AddAssigneesToAssignablePayload, 'assignable'> & { assignable?: Maybe<ResolversTypes['Assignable']> }>;
  RemoveAssigneesFromAssignableInput: RemoveAssigneesFromAssignableInput;
  RemoveAssigneesFromAssignablePayload: ResolverTypeWrapper<Omit<RemoveAssigneesFromAssignablePayload, 'assignable'> & { assignable?: Maybe<ResolversTypes['Assignable']> }>;
  AddCommentInput: AddCommentInput;
  AddCommentPayload: ResolverTypeWrapper<Omit<AddCommentPayload, 'commentEdge' | 'subject'> & { commentEdge?: Maybe<ResolversTypes['IssueCommentEdge']>, subject?: Maybe<ResolversTypes['Node']> }>;
  IssueClosedStateReason: IssueClosedStateReason;
  SearchType: SearchType;
  SearchResultItem: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['SearchResultItem']>;
  SearchResultItemConnection: ResolverTypeWrapper<Omit<SearchResultItemConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['SearchResultItemEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['SearchResultItem']>>> }>;
  SearchResultItemEdge: ResolverTypeWrapper<Omit<SearchResultItemEdge, 'node'> & { node?: Maybe<ResolversTypes['SearchResultItem']> }>;
  PullRequest: ResolverTypeWrapper<PullRequestNode>;
  PullRequestState: PullRequestState;
  PullRequestConnection: ResolverTypeWrapper<Omit<PullRequestConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['PullRequestEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['PullRequest']>>> }>;
  PullRequestEdge: ResolverTypeWrapper<Omit<PullRequestEdge, 'node'> & { node?: Maybe<ResolversTypes['PullRequest']> }>;
  IssueOrder: IssueOrder;
  IssueOrderField: IssueOrderField;
  CreatePullRequestInput: CreatePullRequestInput;
  CreatePullRequestPayload: ResolverTypeWrapper<Omit<CreatePullRequestPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversTypes['PullRequest']> }>;
  MarkPullRequestReadyForReviewInput: MarkPullRequestReadyForReviewInput;
  MarkPullRequestReadyForReviewPayload: ResolverTypeWrapper<Omit<MarkPullRequestReadyForReviewPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversTypes['PullRequest']> }>;
  ConvertPullRequestToDraftInput: ConvertPullRequestToDraftInput;
  ConvertPullRequestToDraftPayload: ResolverTypeWrapper<Omit<ConvertPullRequestToDraftPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversTypes['PullRequest']> }>;
  ClosePullRequestInput: ClosePullRequestInput;
  ClosePullRequestPayload: ResolverTypeWrapper<Omit<ClosePullRequestPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversTypes['PullRequest']> }>;
  ReopenPullRequestInput: ReopenPullRequestInput;
  ReopenPullRequestPayload: ResolverTypeWrapper<Omit<ReopenPullRequestPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversTypes['PullRequest']> }>;
  PullRequestUpdateState: PullRequestUpdateState;
  UpdatePullRequestInput: UpdatePullRequestInput;
  UpdatePullRequestPayload: ResolverTypeWrapper<Omit<UpdatePullRequestPayload, 'actor' | 'pullRequest'> & { actor?: Maybe<ResolversTypes['Actor']>, pullRequest?: Maybe<ResolversTypes['PullRequest']> }>;
  MergePullRequestInput: MergePullRequestInput;
  MergePullRequestPayload: ResolverTypeWrapper<Omit<MergePullRequestPayload, 'actor' | 'pullRequest'> & { actor?: Maybe<ResolversTypes['Actor']>, pullRequest?: Maybe<ResolversTypes['PullRequest']> }>;
  AddPullRequestReviewInput: AddPullRequestReviewInput;
  AddPullRequestReviewPayload: ResolverTypeWrapper<Omit<AddPullRequestReviewPayload, 'pullRequestReview'> & { pullRequestReview?: Maybe<ResolversTypes['PullRequestReview']> }>;
  PullRequestReviewEvent: PullRequestReviewEvent;
  GitTimestamp: ResolverTypeWrapper<Scalars['GitTimestamp']['output']>;
  GitActor: ResolverTypeWrapper<Omit<GitActor, 'user'> & { user?: Maybe<ResolversTypes['User']> }>;
  GitActorConnection: ResolverTypeWrapper<Omit<GitActorConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['GitActorEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['GitActor']>>> }>;
  GitActorEdge: ResolverTypeWrapper<Omit<GitActorEdge, 'node'> & { node?: Maybe<ResolversTypes['GitActor']> }>;
  PullRequestChangedFile: ResolverTypeWrapper<PullRequestChangedFile>;
  PullRequestChangedFileConnection: ResolverTypeWrapper<PullRequestChangedFileConnection>;
  PullRequestChangedFileEdge: ResolverTypeWrapper<PullRequestChangedFileEdge>;
  PatchStatus: PatchStatus;
  FileViewedState: FileViewedState;
  AutoMergeRequest: ResolverTypeWrapper<Omit<AutoMergeRequest, 'enabledBy'> & { enabledBy?: Maybe<ResolversTypes['Actor']> }>;
  PullRequestMergeMethod: PullRequestMergeMethod;
  MergeableState: MergeableState;
  MergeStateStatus: MergeStateStatus;
  PullRequestReviewDecision: PullRequestReviewDecision;
  PullRequestCommit: ResolverTypeWrapper<Omit<PullRequestCommit, 'commit'> & { commit: ResolversTypes['Commit'] }>;
  PullRequestCommitConnection: ResolverTypeWrapper<Omit<PullRequestCommitConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversTypes['PullRequestCommit']>>>, edges?: Maybe<Array<Maybe<ResolversTypes['PullRequestCommitEdge']>>> }>;
  PullRequestCommitEdge: ResolverTypeWrapper<Omit<PullRequestCommitEdge, 'node'> & { node?: Maybe<ResolversTypes['PullRequestCommit']> }>;
  ReviewRequest: ResolverTypeWrapper<Omit<ReviewRequest, 'requestedReviewer'> & { requestedReviewer?: Maybe<ResolversTypes['RequestedReviewer']> }>;
  RequestedReviewer: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['RequestedReviewer']>;
  ReviewRequestConnection: ResolverTypeWrapper<Omit<ReviewRequestConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversTypes['ReviewRequest']>>>, edges?: Maybe<Array<Maybe<ResolversTypes['ReviewRequestEdge']>>> }>;
  ReviewRequestEdge: ResolverTypeWrapper<Omit<ReviewRequestEdge, 'node'> & { node?: Maybe<ResolversTypes['ReviewRequest']> }>;
  Bot: ResolverTypeWrapper<Bot>;
  PullRequestReview: ResolverTypeWrapper<ReviewNode>;
  PullRequestReviewState: PullRequestReviewState;
  CommentAuthorAssociation: CommentAuthorAssociation;
  PullRequestReviewConnection: ResolverTypeWrapper<Omit<PullRequestReviewConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversTypes['PullRequestReview']>>>, edges?: Maybe<Array<Maybe<ResolversTypes['PullRequestReviewEdge']>>> }>;
  PullRequestReviewEdge: ResolverTypeWrapper<Omit<PullRequestReviewEdge, 'node'> & { node?: Maybe<ResolversTypes['PullRequestReview']> }>;
  UserConnection: ResolverTypeWrapper<Omit<UserConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversTypes['User']>>>, edges?: Maybe<Array<Maybe<ResolversTypes['UserEdge']>>> }>;
  UserEdge: ResolverTypeWrapper<Omit<UserEdge, 'node'> & { node?: Maybe<ResolversTypes['User']> }>;
  Label: ResolverTypeWrapper<Label>;
  LabelConnection: ResolverTypeWrapper<LabelConnection>;
  LabelEdge: ResolverTypeWrapper<LabelEdge>;
  IssueComment: ResolverTypeWrapper<CommentNode>;
  IssueCommentConnection: ResolverTypeWrapper<Omit<IssueCommentConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversTypes['IssueComment']>>>, edges?: Maybe<Array<Maybe<ResolversTypes['IssueCommentEdge']>>> }>;
  IssueCommentEdge: ResolverTypeWrapper<Omit<IssueCommentEdge, 'node'> & { node?: Maybe<ResolversTypes['IssueComment']> }>;
  ReactionGroup: ResolverTypeWrapper<ReactionGroup>;
  ReactionContent: ReactionContent;
  StatusCheckRollup: ResolverTypeWrapper<RollupNode>;
  StatusCheckRollupContext: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['StatusCheckRollupContext']>;
  StatusCheckRollupContextConnection: ResolverTypeWrapper<Omit<StatusCheckRollupContextConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversTypes['StatusCheckRollupContext']>>>, edges?: Maybe<Array<Maybe<ResolversTypes['StatusCheckRollupContextEdge']>>> }>;
  StatusCheckRollupContextEdge: ResolverTypeWrapper<Omit<StatusCheckRollupContextEdge, 'node'> & { node?: Maybe<ResolversTypes['StatusCheckRollupContext']> }>;
  StatusContext: ResolverTypeWrapper<StatusContext>;
  StatusState: StatusState;
  CheckRun: ResolverTypeWrapper<CheckRun>;
  CheckStatusState: CheckStatusState;
  CheckConclusionState: CheckConclusionState;
  CheckSuite: ResolverTypeWrapper<CheckSuite>;
  WorkflowRun: ResolverTypeWrapper<WorkflowRun>;
  Workflow: ResolverTypeWrapper<Workflow>;
  ReactingUserConnection: ResolverTypeWrapper<ReactingUserConnection>;
  ProjectV2: ResolverTypeWrapper<ProjectNode>;
  ProjectV2Owner: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['ProjectV2Owner']>;
  ProjectV2Connection: ResolverTypeWrapper<Omit<ProjectV2Connection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['ProjectV2Edge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['ProjectV2']>>> }>;
  ProjectV2Edge: ResolverTypeWrapper<Omit<ProjectV2Edge, 'node'> & { node?: Maybe<ResolversTypes['ProjectV2']> }>;
  ProjectV2Order: ProjectV2Order;
  ProjectV2OrderField: ProjectV2OrderField;
  ProjectV2PermissionLevel: ProjectV2PermissionLevel;
  ProjectV2FieldOrder: ProjectV2FieldOrder;
  ProjectV2FieldOrderField: ProjectV2FieldOrderField;
  ProjectV2ItemOrder: ProjectV2ItemOrder;
  ProjectV2ItemOrderField: ProjectV2ItemOrderField;
  ProjectV2ItemFieldValueOrder: ProjectV2ItemFieldValueOrder;
  ProjectV2ItemFieldValueOrderField: ProjectV2ItemFieldValueOrderField;
  ProjectV2ItemArchivedState: ProjectV2ItemArchivedState;
  ProjectV2FieldCommon: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['ProjectV2FieldCommon']>;
  ProjectV2Field: ResolverTypeWrapper<ProjectFieldNode>;
  ProjectV2SingleSelectField: ResolverTypeWrapper<ProjectFieldNode>;
  ProjectV2FieldConfiguration: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['ProjectV2FieldConfiguration']>;
  ProjectV2FieldConfigurationConnection: ResolverTypeWrapper<Omit<ProjectV2FieldConfigurationConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['ProjectV2FieldConfigurationEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['ProjectV2FieldConfiguration']>>> }>;
  ProjectV2FieldConfigurationEdge: ResolverTypeWrapper<Omit<ProjectV2FieldConfigurationEdge, 'node'> & { node?: Maybe<ResolversTypes['ProjectV2FieldConfiguration']> }>;
  ProjectV2SingleSelectFieldOption: ResolverTypeWrapper<ProjectV2SingleSelectFieldOption>;
  ProjectV2SingleSelectFieldOptionColor: ProjectV2SingleSelectFieldOptionColor;
  ProjectV2FieldType: ProjectV2FieldType;
  ProjectV2Item: ResolverTypeWrapper<ProjectItemNode>;
  ProjectV2ItemConnection: ResolverTypeWrapper<Omit<ProjectV2ItemConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['ProjectV2ItemEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['ProjectV2Item']>>> }>;
  ProjectV2ItemEdge: ResolverTypeWrapper<Omit<ProjectV2ItemEdge, 'node'> & { node?: Maybe<ResolversTypes['ProjectV2Item']> }>;
  ProjectV2ItemContent: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['ProjectV2ItemContent']>;
  ProjectV2ItemType: ProjectV2ItemType;
  DraftIssue: ResolverTypeWrapper<DraftIssueNode>;
  ProjectV2ItemFieldValue: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['ProjectV2ItemFieldValue']>;
  ProjectV2ItemFieldValueConnection: ResolverTypeWrapper<Omit<ProjectV2ItemFieldValueConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['ProjectV2ItemFieldValueEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['ProjectV2ItemFieldValue']>>> }>;
  ProjectV2ItemFieldValueEdge: ResolverTypeWrapper<Omit<ProjectV2ItemFieldValueEdge, 'node'> & { node?: Maybe<ResolversTypes['ProjectV2ItemFieldValue']> }>;
  ProjectV2ItemFieldTextValue: ResolverTypeWrapper<ProjectFieldValueNode>;
  ProjectV2ItemFieldNumberValue: ResolverTypeWrapper<ProjectFieldValueNode>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  ProjectV2ItemFieldDateValue: ResolverTypeWrapper<ProjectFieldValueNode>;
  ProjectV2ItemFieldSingleSelectValue: ResolverTypeWrapper<ProjectFieldValueNode>;
  CreateProjectV2Input: CreateProjectV2Input;
  CreateProjectV2Payload: ResolverTypeWrapper<Omit<CreateProjectV2Payload, 'projectV2'> & { projectV2?: Maybe<ResolversTypes['ProjectV2']> }>;
  AddProjectV2ItemByIdInput: AddProjectV2ItemByIdInput;
  AddProjectV2ItemByIdPayload: ResolverTypeWrapper<Omit<AddProjectV2ItemByIdPayload, 'item'> & { item?: Maybe<ResolversTypes['ProjectV2Item']> }>;
  AddProjectV2DraftIssueInput: AddProjectV2DraftIssueInput;
  AddProjectV2DraftIssuePayload: ResolverTypeWrapper<Omit<AddProjectV2DraftIssuePayload, 'projectItem'> & { projectItem?: Maybe<ResolversTypes['ProjectV2Item']> }>;
  UpdateProjectV2DraftIssueInput: UpdateProjectV2DraftIssueInput;
  UpdateProjectV2DraftIssuePayload: ResolverTypeWrapper<Omit<UpdateProjectV2DraftIssuePayload, 'draftIssue'> & { draftIssue?: Maybe<ResolversTypes['DraftIssue']> }>;
  UpdateProjectV2ItemFieldValueInput: UpdateProjectV2ItemFieldValueInput;
  UpdateProjectV2ItemFieldValuePayload: ResolverTypeWrapper<Omit<UpdateProjectV2ItemFieldValuePayload, 'projectV2Item'> & { projectV2Item?: Maybe<ResolversTypes['ProjectV2Item']> }>;
  ClearProjectV2ItemFieldValueInput: ClearProjectV2ItemFieldValueInput;
  ClearProjectV2ItemFieldValuePayload: ResolverTypeWrapper<Omit<ClearProjectV2ItemFieldValuePayload, 'projectV2Item'> & { projectV2Item?: Maybe<ResolversTypes['ProjectV2Item']> }>;
  CreateProjectV2FieldInput: CreateProjectV2FieldInput;
  CreateProjectV2FieldPayload: ResolverTypeWrapper<Omit<CreateProjectV2FieldPayload, 'projectV2Field'> & { projectV2Field?: Maybe<ResolversTypes['ProjectV2FieldConfiguration']> }>;
  ProjectV2CustomFieldType: ProjectV2CustomFieldType;
  ProjectV2FieldValue: ProjectV2FieldValue;
  ProjectV2SingleSelectFieldOptionInput: ProjectV2SingleSelectFieldOptionInput;
  Date: ResolverTypeWrapper<Scalars['Date']['output']>;
  ProjectV2IterationField: ResolverTypeWrapper<ProjectV2IterationField>;
  ProjectV2ItemFieldIterationValue: ResolverTypeWrapper<Omit<ProjectV2ItemFieldIterationValue, 'field'> & { field: ResolversTypes['ProjectV2FieldConfiguration'] }>;
  ProjectV2ItemFieldLabelValue: ResolverTypeWrapper<Omit<ProjectV2ItemFieldLabelValue, 'field'> & { field: ResolversTypes['ProjectV2FieldConfiguration'] }>;
  ProjectV2ItemFieldMilestoneValue: ResolverTypeWrapper<Omit<ProjectV2ItemFieldMilestoneValue, 'field'> & { field: ResolversTypes['ProjectV2FieldConfiguration'] }>;
  ProjectV2ItemFieldPullRequestValue: ResolverTypeWrapper<Omit<ProjectV2ItemFieldPullRequestValue, 'field' | 'pullRequests'> & { field: ResolversTypes['ProjectV2FieldConfiguration'], pullRequests?: Maybe<ResolversTypes['PullRequestConnection']> }>;
  ProjectV2ItemFieldRepositoryValue: ResolverTypeWrapper<Omit<ProjectV2ItemFieldRepositoryValue, 'field' | 'repository'> & { field: ResolversTypes['ProjectV2FieldConfiguration'], repository?: Maybe<ResolversTypes['Repository']> }>;
  ProjectV2ItemFieldReviewerValue: ResolverTypeWrapper<Omit<ProjectV2ItemFieldReviewerValue, 'field' | 'reviewers'> & { field: ResolversTypes['ProjectV2FieldConfiguration'], reviewers?: Maybe<ResolversTypes['RequestedReviewerConnection']> }>;
  ProjectV2ItemFieldUserValue: ResolverTypeWrapper<Omit<ProjectV2ItemFieldUserValue, 'field' | 'users'> & { field: ResolversTypes['ProjectV2FieldConfiguration'], users?: Maybe<ResolversTypes['UserConnection']> }>;
  RequestedReviewerConnection: ResolverTypeWrapper<Omit<RequestedReviewerConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['RequestedReviewerEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['RequestedReviewer']>>> }>;
  PullRequestOrder: PullRequestOrder;
  RequestedReviewerEdge: ResolverTypeWrapper<Omit<RequestedReviewerEdge, 'node'> & { node?: Maybe<ResolversTypes['RequestedReviewer']> }>;
  PullRequestOrderField: PullRequestOrderField;
  Discussion: ResolverTypeWrapper<DiscussionNode>;
  DiscussionCategory: ResolverTypeWrapper<DiscussionCategoryNode>;
  DiscussionComment: ResolverTypeWrapper<DiscussionCommentNode>;
  DiscussionConnection: ResolverTypeWrapper<Omit<DiscussionConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['DiscussionEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['Discussion']>>> }>;
  DiscussionEdge: ResolverTypeWrapper<Omit<DiscussionEdge, 'node'> & { node?: Maybe<ResolversTypes['Discussion']> }>;
  DiscussionCategoryConnection: ResolverTypeWrapper<Omit<DiscussionCategoryConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['DiscussionCategoryEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['DiscussionCategory']>>> }>;
  DiscussionCategoryEdge: ResolverTypeWrapper<Omit<DiscussionCategoryEdge, 'node'> & { node?: Maybe<ResolversTypes['DiscussionCategory']> }>;
  DiscussionCommentConnection: ResolverTypeWrapper<Omit<DiscussionCommentConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['DiscussionCommentEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['DiscussionComment']>>> }>;
  DiscussionCommentEdge: ResolverTypeWrapper<Omit<DiscussionCommentEdge, 'node'> & { node?: Maybe<ResolversTypes['DiscussionComment']> }>;
  DiscussionOrder: DiscussionOrder;
  DiscussionOrderField: DiscussionOrderField;
  DiscussionState: DiscussionState;
  DiscussionStateReason: DiscussionStateReason;
  DiscussionCloseReason: DiscussionCloseReason;
  Votable: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Votable']>;
  CreateDiscussionInput: CreateDiscussionInput;
  CreateDiscussionPayload: ResolverTypeWrapper<Omit<CreateDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversTypes['Discussion']> }>;
  AddDiscussionCommentInput: AddDiscussionCommentInput;
  AddDiscussionCommentPayload: ResolverTypeWrapper<Omit<AddDiscussionCommentPayload, 'comment'> & { comment?: Maybe<ResolversTypes['DiscussionComment']> }>;
  MarkDiscussionCommentAsAnswerInput: MarkDiscussionCommentAsAnswerInput;
  MarkDiscussionCommentAsAnswerPayload: ResolverTypeWrapper<Omit<MarkDiscussionCommentAsAnswerPayload, 'discussion'> & { discussion?: Maybe<ResolversTypes['Discussion']> }>;
  UnmarkDiscussionCommentAsAnswerInput: UnmarkDiscussionCommentAsAnswerInput;
  UnmarkDiscussionCommentAsAnswerPayload: ResolverTypeWrapper<Omit<UnmarkDiscussionCommentAsAnswerPayload, 'discussion'> & { discussion?: Maybe<ResolversTypes['Discussion']> }>;
  AddUpvoteInput: AddUpvoteInput;
  AddUpvotePayload: ResolverTypeWrapper<Omit<AddUpvotePayload, 'subject'> & { subject?: Maybe<ResolversTypes['Votable']> }>;
  RemoveUpvoteInput: RemoveUpvoteInput;
  RemoveUpvotePayload: ResolverTypeWrapper<Omit<RemoveUpvotePayload, 'subject'> & { subject?: Maybe<ResolversTypes['Votable']> }>;
  CloseDiscussionInput: CloseDiscussionInput;
  CloseDiscussionPayload: ResolverTypeWrapper<Omit<CloseDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversTypes['Discussion']> }>;
  ReopenDiscussionInput: ReopenDiscussionInput;
  ReopenDiscussionPayload: ResolverTypeWrapper<Omit<ReopenDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversTypes['Discussion']> }>;
  UpdateDiscussionInput: UpdateDiscussionInput;
  UpdateDiscussionPayload: ResolverTypeWrapper<Omit<UpdateDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversTypes['Discussion']> }>;
  DeleteDiscussionInput: DeleteDiscussionInput;
  DeleteDiscussionPayload: ResolverTypeWrapper<Omit<DeleteDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversTypes['Discussion']> }>;
  UpdateDiscussionCommentInput: UpdateDiscussionCommentInput;
  UpdateDiscussionCommentPayload: ResolverTypeWrapper<Omit<UpdateDiscussionCommentPayload, 'comment'> & { comment?: Maybe<ResolversTypes['DiscussionComment']> }>;
  DeleteDiscussionCommentInput: DeleteDiscussionCommentInput;
  DeleteDiscussionCommentPayload: ResolverTypeWrapper<Omit<DeleteDiscussionCommentPayload, 'comment'> & { comment?: Maybe<ResolversTypes['DiscussionComment']> }>;
  Gist: ResolverTypeWrapper<GistNode>;
  GistFile: ResolverTypeWrapper<GistFileNode>;
  GistComment: ResolverTypeWrapper<GistCommentNode>;
  GistConnection: ResolverTypeWrapper<Omit<GistConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['GistEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['Gist']>>> }>;
  GistEdge: ResolverTypeWrapper<Omit<GistEdge, 'node'> & { node?: Maybe<ResolversTypes['Gist']> }>;
  GistCommentConnection: ResolverTypeWrapper<Omit<GistCommentConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['GistCommentEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['GistComment']>>> }>;
  GistCommentEdge: ResolverTypeWrapper<Omit<GistCommentEdge, 'node'> & { node?: Maybe<ResolversTypes['GistComment']> }>;
  GistOrder: GistOrder;
  GistOrderField: GistOrderField;
  GistPrivacy: GistPrivacy;
  Language: ResolverTypeWrapper<LanguageNode>;
  StargazerConnection: ResolverTypeWrapper<Omit<StargazerConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversTypes['StargazerEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversTypes['User']>>> }>;
  StargazerEdge: ResolverTypeWrapper<Omit<StargazerEdge, 'node'> & { node: ResolversTypes['User'] }>;
  StarOrder: StarOrder;
  StarOrderField: StarOrderField;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Query: Record<PropertyKey, never>;
  ID: Scalars['ID']['output'];
  String: Scalars['String']['output'];
  Int: Scalars['Int']['output'];
  Node: ResolversInterfaceTypes<ResolversParentTypes>['Node'];
  PageInfo: PageInfo;
  Boolean: Scalars['Boolean']['output'];
  RateLimit: RateLimitInfo;
  UniformResourceLocatable: ResolversInterfaceTypes<ResolversParentTypes>['UniformResourceLocatable'];
  Actor: ResolversInterfaceTypes<ResolversParentTypes>['Actor'];
  User: UserNode;
  DateTime: Scalars['DateTime']['output'];
  URI: Scalars['URI']['output'];
  Mutation: Record<PropertyKey, never>;
  RepositoryOwner: ResolversInterfaceTypes<ResolversParentTypes>['RepositoryOwner'];
  RepositoryInfo: ResolversInterfaceTypes<ResolversParentTypes>['RepositoryInfo'];
  Starrable: ResolversInterfaceTypes<ResolversParentTypes>['Starrable'];
  Repository: RepositoryNode;
  RepositoryConnection: Omit<RepositoryConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['RepositoryEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['Repository']>>> };
  RepositoryEdge: Omit<RepositoryEdge, 'node'> & { node?: Maybe<ResolversParentTypes['Repository']> };
  Ref: RefNode;
  BranchProtectionRule: BranchProtectionRule;
  GitObject: ResolversInterfaceTypes<ResolversParentTypes>['GitObject'];
  Commit: CommitNode;
  Blame: Omit<Blame, 'ranges'> & { ranges: Array<ResolversParentTypes['BlameRange']> };
  BlameRange: Omit<BlameRange, 'commit'> & { commit: ResolversParentTypes['Commit'] };
  GitObjectID: Scalars['GitObjectID']['output'];
  RepositoryOrder: RepositoryOrder;
  CreateRepositoryInput: CreateRepositoryInput;
  CreateRepositoryPayload: Omit<CreateRepositoryPayload, 'repository'> & { repository?: Maybe<ResolversParentTypes['Repository']> };
  UpdateRepositoryInput: UpdateRepositoryInput;
  UpdateRepositoryPayload: Omit<UpdateRepositoryPayload, 'repository'> & { repository?: Maybe<ResolversParentTypes['Repository']> };
  CreateLabelInput: CreateLabelInput;
  CreateLabelPayload: CreateLabelPayload;
  UpdateLabelInput: UpdateLabelInput;
  UpdateLabelPayload: UpdateLabelPayload;
  DeleteLabelInput: DeleteLabelInput;
  DeleteLabelPayload: DeleteLabelPayload;
  LabelOrder: LabelOrder;
  GitSSHRemote: Scalars['GitSSHRemote']['output'];
  Release: ReleaseNode;
  ReleaseAsset: ReleaseAssetNode;
  ReleaseConnection: Omit<ReleaseConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['ReleaseEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['Release']>>> };
  ReleaseEdge: Omit<ReleaseEdge, 'node'> & { node?: Maybe<ResolversParentTypes['Release']> };
  ReleaseAssetConnection: Omit<ReleaseAssetConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['ReleaseAssetEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['ReleaseAsset']>>> };
  ReleaseAssetEdge: Omit<ReleaseAssetEdge, 'node'> & { node?: Maybe<ResolversParentTypes['ReleaseAsset']> };
  ReleaseOrder: ReleaseOrder;
  IssueTemplate: IssueTemplateNode;
  PullRequestTemplate: Omit<PullRequestTemplate, 'repository'> & { repository: ResolversParentTypes['Repository'] };
  GitSignature: ResolversInterfaceTypes<ResolversParentTypes>['GitSignature'];
  GpgSignature: GitSignatureNode;
  SshSignature: GitSignatureNode;
  Organization: OrganizationNode;
  OrganizationConnection: Omit<OrganizationConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['OrganizationEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['Organization']>>> };
  OrganizationEdge: Omit<OrganizationEdge, 'node'> & { node?: Maybe<ResolversParentTypes['Organization']> };
  Team: TeamNode;
  TeamConnection: Omit<TeamConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['TeamEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['Team']>>> };
  TeamEdge: Omit<TeamEdge, 'node'> & { node?: Maybe<ResolversParentTypes['Team']> };
  TeamMemberConnection: Omit<TeamMemberConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['TeamMemberEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['User']>>> };
  TeamMemberEdge: TeamMemberEdgeNode;
  TeamRepositoryConnection: Omit<TeamRepositoryConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['TeamRepositoryEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['Repository']>>> };
  TeamRepositoryEdge: TeamRepositoryEdgeNode;
  Issue: IssueNode;
  IssueOrPullRequest: ResolversUnionTypes<ResolversParentTypes>['IssueOrPullRequest'];
  Milestone: Milestone;
  MilestoneConnection: MilestoneConnection;
  MilestoneEdge: MilestoneEdge;
  MilestoneOrder: MilestoneOrder;
  ProjectCardConnection: ProjectCardConnection;
  ProjectCardEdge: ProjectCardEdge;
  ProjectCard: ProjectCard;
  Project: Project;
  ProjectColumn: ProjectColumn;
  IssueConnection: Omit<IssueConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['IssueEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['Issue']>>> };
  IssueEdge: Omit<IssueEdge, 'node'> & { node?: Maybe<ResolversParentTypes['Issue']> };
  IssueFilters: IssueFilters;
  IssueType: IssueType;
  SubIssuesSummary: SubIssuesSummary;
  Labelable: ResolversInterfaceTypes<ResolversParentTypes>['Labelable'];
  Assignable: ResolversInterfaceTypes<ResolversParentTypes>['Assignable'];
  CreateIssueInput: CreateIssueInput;
  CreateIssuePayload: Omit<CreateIssuePayload, 'issue'> & { issue?: Maybe<ResolversParentTypes['Issue']> };
  UpdateIssueInput: UpdateIssueInput;
  UpdateIssuePayload: Omit<UpdateIssuePayload, 'issue'> & { issue?: Maybe<ResolversParentTypes['Issue']> };
  CloseIssueInput: CloseIssueInput;
  CloseIssuePayload: Omit<CloseIssuePayload, 'issue'> & { issue?: Maybe<ResolversParentTypes['Issue']> };
  ReopenIssueInput: ReopenIssueInput;
  ReopenIssuePayload: Omit<ReopenIssuePayload, 'issue'> & { issue?: Maybe<ResolversParentTypes['Issue']> };
  AddLabelsToLabelableInput: AddLabelsToLabelableInput;
  AddLabelsToLabelablePayload: Omit<AddLabelsToLabelablePayload, 'labelable'> & { labelable?: Maybe<ResolversParentTypes['Labelable']> };
  RemoveLabelsFromLabelableInput: RemoveLabelsFromLabelableInput;
  RemoveLabelsFromLabelablePayload: Omit<RemoveLabelsFromLabelablePayload, 'labelable'> & { labelable?: Maybe<ResolversParentTypes['Labelable']> };
  AddAssigneesToAssignableInput: AddAssigneesToAssignableInput;
  AddAssigneesToAssignablePayload: Omit<AddAssigneesToAssignablePayload, 'assignable'> & { assignable?: Maybe<ResolversParentTypes['Assignable']> };
  RemoveAssigneesFromAssignableInput: RemoveAssigneesFromAssignableInput;
  RemoveAssigneesFromAssignablePayload: Omit<RemoveAssigneesFromAssignablePayload, 'assignable'> & { assignable?: Maybe<ResolversParentTypes['Assignable']> };
  AddCommentInput: AddCommentInput;
  AddCommentPayload: Omit<AddCommentPayload, 'commentEdge' | 'subject'> & { commentEdge?: Maybe<ResolversParentTypes['IssueCommentEdge']>, subject?: Maybe<ResolversParentTypes['Node']> };
  SearchResultItem: ResolversUnionTypes<ResolversParentTypes>['SearchResultItem'];
  SearchResultItemConnection: Omit<SearchResultItemConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['SearchResultItemEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['SearchResultItem']>>> };
  SearchResultItemEdge: Omit<SearchResultItemEdge, 'node'> & { node?: Maybe<ResolversParentTypes['SearchResultItem']> };
  PullRequest: PullRequestNode;
  PullRequestConnection: Omit<PullRequestConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['PullRequest']>>> };
  PullRequestEdge: Omit<PullRequestEdge, 'node'> & { node?: Maybe<ResolversParentTypes['PullRequest']> };
  IssueOrder: IssueOrder;
  CreatePullRequestInput: CreatePullRequestInput;
  CreatePullRequestPayload: Omit<CreatePullRequestPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversParentTypes['PullRequest']> };
  MarkPullRequestReadyForReviewInput: MarkPullRequestReadyForReviewInput;
  MarkPullRequestReadyForReviewPayload: Omit<MarkPullRequestReadyForReviewPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversParentTypes['PullRequest']> };
  ConvertPullRequestToDraftInput: ConvertPullRequestToDraftInput;
  ConvertPullRequestToDraftPayload: Omit<ConvertPullRequestToDraftPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversParentTypes['PullRequest']> };
  ClosePullRequestInput: ClosePullRequestInput;
  ClosePullRequestPayload: Omit<ClosePullRequestPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversParentTypes['PullRequest']> };
  ReopenPullRequestInput: ReopenPullRequestInput;
  ReopenPullRequestPayload: Omit<ReopenPullRequestPayload, 'pullRequest'> & { pullRequest?: Maybe<ResolversParentTypes['PullRequest']> };
  UpdatePullRequestInput: UpdatePullRequestInput;
  UpdatePullRequestPayload: Omit<UpdatePullRequestPayload, 'actor' | 'pullRequest'> & { actor?: Maybe<ResolversParentTypes['Actor']>, pullRequest?: Maybe<ResolversParentTypes['PullRequest']> };
  MergePullRequestInput: MergePullRequestInput;
  MergePullRequestPayload: Omit<MergePullRequestPayload, 'actor' | 'pullRequest'> & { actor?: Maybe<ResolversParentTypes['Actor']>, pullRequest?: Maybe<ResolversParentTypes['PullRequest']> };
  AddPullRequestReviewInput: AddPullRequestReviewInput;
  AddPullRequestReviewPayload: Omit<AddPullRequestReviewPayload, 'pullRequestReview'> & { pullRequestReview?: Maybe<ResolversParentTypes['PullRequestReview']> };
  GitTimestamp: Scalars['GitTimestamp']['output'];
  GitActor: Omit<GitActor, 'user'> & { user?: Maybe<ResolversParentTypes['User']> };
  GitActorConnection: Omit<GitActorConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['GitActorEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['GitActor']>>> };
  GitActorEdge: Omit<GitActorEdge, 'node'> & { node?: Maybe<ResolversParentTypes['GitActor']> };
  PullRequestChangedFile: PullRequestChangedFile;
  PullRequestChangedFileConnection: PullRequestChangedFileConnection;
  PullRequestChangedFileEdge: PullRequestChangedFileEdge;
  AutoMergeRequest: Omit<AutoMergeRequest, 'enabledBy'> & { enabledBy?: Maybe<ResolversParentTypes['Actor']> };
  PullRequestCommit: Omit<PullRequestCommit, 'commit'> & { commit: ResolversParentTypes['Commit'] };
  PullRequestCommitConnection: Omit<PullRequestCommitConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestCommit']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestCommitEdge']>>> };
  PullRequestCommitEdge: Omit<PullRequestCommitEdge, 'node'> & { node?: Maybe<ResolversParentTypes['PullRequestCommit']> };
  ReviewRequest: Omit<ReviewRequest, 'requestedReviewer'> & { requestedReviewer?: Maybe<ResolversParentTypes['RequestedReviewer']> };
  RequestedReviewer: ResolversUnionTypes<ResolversParentTypes>['RequestedReviewer'];
  ReviewRequestConnection: Omit<ReviewRequestConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['ReviewRequest']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['ReviewRequestEdge']>>> };
  ReviewRequestEdge: Omit<ReviewRequestEdge, 'node'> & { node?: Maybe<ResolversParentTypes['ReviewRequest']> };
  Bot: Bot;
  PullRequestReview: ReviewNode;
  PullRequestReviewConnection: Omit<PullRequestReviewConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestReview']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestReviewEdge']>>> };
  PullRequestReviewEdge: Omit<PullRequestReviewEdge, 'node'> & { node?: Maybe<ResolversParentTypes['PullRequestReview']> };
  UserConnection: Omit<UserConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['User']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['UserEdge']>>> };
  UserEdge: Omit<UserEdge, 'node'> & { node?: Maybe<ResolversParentTypes['User']> };
  Label: Label;
  LabelConnection: LabelConnection;
  LabelEdge: LabelEdge;
  IssueComment: CommentNode;
  IssueCommentConnection: Omit<IssueCommentConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['IssueComment']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['IssueCommentEdge']>>> };
  IssueCommentEdge: Omit<IssueCommentEdge, 'node'> & { node?: Maybe<ResolversParentTypes['IssueComment']> };
  ReactionGroup: ReactionGroup;
  StatusCheckRollup: RollupNode;
  StatusCheckRollupContext: ResolversUnionTypes<ResolversParentTypes>['StatusCheckRollupContext'];
  StatusCheckRollupContextConnection: Omit<StatusCheckRollupContextConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['StatusCheckRollupContext']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['StatusCheckRollupContextEdge']>>> };
  StatusCheckRollupContextEdge: Omit<StatusCheckRollupContextEdge, 'node'> & { node?: Maybe<ResolversParentTypes['StatusCheckRollupContext']> };
  StatusContext: StatusContext;
  CheckRun: CheckRun;
  CheckSuite: CheckSuite;
  WorkflowRun: WorkflowRun;
  Workflow: Workflow;
  ReactingUserConnection: ReactingUserConnection;
  ProjectV2: ProjectNode;
  ProjectV2Owner: ResolversInterfaceTypes<ResolversParentTypes>['ProjectV2Owner'];
  ProjectV2Connection: Omit<ProjectV2Connection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['ProjectV2Edge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['ProjectV2']>>> };
  ProjectV2Edge: Omit<ProjectV2Edge, 'node'> & { node?: Maybe<ResolversParentTypes['ProjectV2']> };
  ProjectV2Order: ProjectV2Order;
  ProjectV2FieldOrder: ProjectV2FieldOrder;
  ProjectV2ItemOrder: ProjectV2ItemOrder;
  ProjectV2ItemFieldValueOrder: ProjectV2ItemFieldValueOrder;
  ProjectV2FieldCommon: ResolversInterfaceTypes<ResolversParentTypes>['ProjectV2FieldCommon'];
  ProjectV2Field: ProjectFieldNode;
  ProjectV2SingleSelectField: ProjectFieldNode;
  ProjectV2FieldConfiguration: ResolversUnionTypes<ResolversParentTypes>['ProjectV2FieldConfiguration'];
  ProjectV2FieldConfigurationConnection: Omit<ProjectV2FieldConfigurationConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['ProjectV2FieldConfigurationEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['ProjectV2FieldConfiguration']>>> };
  ProjectV2FieldConfigurationEdge: Omit<ProjectV2FieldConfigurationEdge, 'node'> & { node?: Maybe<ResolversParentTypes['ProjectV2FieldConfiguration']> };
  ProjectV2SingleSelectFieldOption: ProjectV2SingleSelectFieldOption;
  ProjectV2Item: ProjectItemNode;
  ProjectV2ItemConnection: Omit<ProjectV2ItemConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['ProjectV2ItemEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['ProjectV2Item']>>> };
  ProjectV2ItemEdge: Omit<ProjectV2ItemEdge, 'node'> & { node?: Maybe<ResolversParentTypes['ProjectV2Item']> };
  ProjectV2ItemContent: ResolversUnionTypes<ResolversParentTypes>['ProjectV2ItemContent'];
  DraftIssue: DraftIssueNode;
  ProjectV2ItemFieldValue: ResolversUnionTypes<ResolversParentTypes>['ProjectV2ItemFieldValue'];
  ProjectV2ItemFieldValueConnection: Omit<ProjectV2ItemFieldValueConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['ProjectV2ItemFieldValueEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['ProjectV2ItemFieldValue']>>> };
  ProjectV2ItemFieldValueEdge: Omit<ProjectV2ItemFieldValueEdge, 'node'> & { node?: Maybe<ResolversParentTypes['ProjectV2ItemFieldValue']> };
  ProjectV2ItemFieldTextValue: ProjectFieldValueNode;
  ProjectV2ItemFieldNumberValue: ProjectFieldValueNode;
  Float: Scalars['Float']['output'];
  ProjectV2ItemFieldDateValue: ProjectFieldValueNode;
  ProjectV2ItemFieldSingleSelectValue: ProjectFieldValueNode;
  CreateProjectV2Input: CreateProjectV2Input;
  CreateProjectV2Payload: Omit<CreateProjectV2Payload, 'projectV2'> & { projectV2?: Maybe<ResolversParentTypes['ProjectV2']> };
  AddProjectV2ItemByIdInput: AddProjectV2ItemByIdInput;
  AddProjectV2ItemByIdPayload: Omit<AddProjectV2ItemByIdPayload, 'item'> & { item?: Maybe<ResolversParentTypes['ProjectV2Item']> };
  AddProjectV2DraftIssueInput: AddProjectV2DraftIssueInput;
  AddProjectV2DraftIssuePayload: Omit<AddProjectV2DraftIssuePayload, 'projectItem'> & { projectItem?: Maybe<ResolversParentTypes['ProjectV2Item']> };
  UpdateProjectV2DraftIssueInput: UpdateProjectV2DraftIssueInput;
  UpdateProjectV2DraftIssuePayload: Omit<UpdateProjectV2DraftIssuePayload, 'draftIssue'> & { draftIssue?: Maybe<ResolversParentTypes['DraftIssue']> };
  UpdateProjectV2ItemFieldValueInput: UpdateProjectV2ItemFieldValueInput;
  UpdateProjectV2ItemFieldValuePayload: Omit<UpdateProjectV2ItemFieldValuePayload, 'projectV2Item'> & { projectV2Item?: Maybe<ResolversParentTypes['ProjectV2Item']> };
  ClearProjectV2ItemFieldValueInput: ClearProjectV2ItemFieldValueInput;
  ClearProjectV2ItemFieldValuePayload: Omit<ClearProjectV2ItemFieldValuePayload, 'projectV2Item'> & { projectV2Item?: Maybe<ResolversParentTypes['ProjectV2Item']> };
  CreateProjectV2FieldInput: CreateProjectV2FieldInput;
  CreateProjectV2FieldPayload: Omit<CreateProjectV2FieldPayload, 'projectV2Field'> & { projectV2Field?: Maybe<ResolversParentTypes['ProjectV2FieldConfiguration']> };
  ProjectV2FieldValue: ProjectV2FieldValue;
  ProjectV2SingleSelectFieldOptionInput: ProjectV2SingleSelectFieldOptionInput;
  Date: Scalars['Date']['output'];
  ProjectV2IterationField: ProjectV2IterationField;
  ProjectV2ItemFieldIterationValue: Omit<ProjectV2ItemFieldIterationValue, 'field'> & { field: ResolversParentTypes['ProjectV2FieldConfiguration'] };
  ProjectV2ItemFieldLabelValue: Omit<ProjectV2ItemFieldLabelValue, 'field'> & { field: ResolversParentTypes['ProjectV2FieldConfiguration'] };
  ProjectV2ItemFieldMilestoneValue: Omit<ProjectV2ItemFieldMilestoneValue, 'field'> & { field: ResolversParentTypes['ProjectV2FieldConfiguration'] };
  ProjectV2ItemFieldPullRequestValue: Omit<ProjectV2ItemFieldPullRequestValue, 'field' | 'pullRequests'> & { field: ResolversParentTypes['ProjectV2FieldConfiguration'], pullRequests?: Maybe<ResolversParentTypes['PullRequestConnection']> };
  ProjectV2ItemFieldRepositoryValue: Omit<ProjectV2ItemFieldRepositoryValue, 'field' | 'repository'> & { field: ResolversParentTypes['ProjectV2FieldConfiguration'], repository?: Maybe<ResolversParentTypes['Repository']> };
  ProjectV2ItemFieldReviewerValue: Omit<ProjectV2ItemFieldReviewerValue, 'field' | 'reviewers'> & { field: ResolversParentTypes['ProjectV2FieldConfiguration'], reviewers?: Maybe<ResolversParentTypes['RequestedReviewerConnection']> };
  ProjectV2ItemFieldUserValue: Omit<ProjectV2ItemFieldUserValue, 'field' | 'users'> & { field: ResolversParentTypes['ProjectV2FieldConfiguration'], users?: Maybe<ResolversParentTypes['UserConnection']> };
  RequestedReviewerConnection: Omit<RequestedReviewerConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['RequestedReviewerEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['RequestedReviewer']>>> };
  PullRequestOrder: PullRequestOrder;
  RequestedReviewerEdge: Omit<RequestedReviewerEdge, 'node'> & { node?: Maybe<ResolversParentTypes['RequestedReviewer']> };
  Discussion: DiscussionNode;
  DiscussionCategory: DiscussionCategoryNode;
  DiscussionComment: DiscussionCommentNode;
  DiscussionConnection: Omit<DiscussionConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['DiscussionEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['Discussion']>>> };
  DiscussionEdge: Omit<DiscussionEdge, 'node'> & { node?: Maybe<ResolversParentTypes['Discussion']> };
  DiscussionCategoryConnection: Omit<DiscussionCategoryConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['DiscussionCategoryEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['DiscussionCategory']>>> };
  DiscussionCategoryEdge: Omit<DiscussionCategoryEdge, 'node'> & { node?: Maybe<ResolversParentTypes['DiscussionCategory']> };
  DiscussionCommentConnection: Omit<DiscussionCommentConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['DiscussionCommentEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['DiscussionComment']>>> };
  DiscussionCommentEdge: Omit<DiscussionCommentEdge, 'node'> & { node?: Maybe<ResolversParentTypes['DiscussionComment']> };
  DiscussionOrder: DiscussionOrder;
  Votable: ResolversInterfaceTypes<ResolversParentTypes>['Votable'];
  CreateDiscussionInput: CreateDiscussionInput;
  CreateDiscussionPayload: Omit<CreateDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversParentTypes['Discussion']> };
  AddDiscussionCommentInput: AddDiscussionCommentInput;
  AddDiscussionCommentPayload: Omit<AddDiscussionCommentPayload, 'comment'> & { comment?: Maybe<ResolversParentTypes['DiscussionComment']> };
  MarkDiscussionCommentAsAnswerInput: MarkDiscussionCommentAsAnswerInput;
  MarkDiscussionCommentAsAnswerPayload: Omit<MarkDiscussionCommentAsAnswerPayload, 'discussion'> & { discussion?: Maybe<ResolversParentTypes['Discussion']> };
  UnmarkDiscussionCommentAsAnswerInput: UnmarkDiscussionCommentAsAnswerInput;
  UnmarkDiscussionCommentAsAnswerPayload: Omit<UnmarkDiscussionCommentAsAnswerPayload, 'discussion'> & { discussion?: Maybe<ResolversParentTypes['Discussion']> };
  AddUpvoteInput: AddUpvoteInput;
  AddUpvotePayload: Omit<AddUpvotePayload, 'subject'> & { subject?: Maybe<ResolversParentTypes['Votable']> };
  RemoveUpvoteInput: RemoveUpvoteInput;
  RemoveUpvotePayload: Omit<RemoveUpvotePayload, 'subject'> & { subject?: Maybe<ResolversParentTypes['Votable']> };
  CloseDiscussionInput: CloseDiscussionInput;
  CloseDiscussionPayload: Omit<CloseDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversParentTypes['Discussion']> };
  ReopenDiscussionInput: ReopenDiscussionInput;
  ReopenDiscussionPayload: Omit<ReopenDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversParentTypes['Discussion']> };
  UpdateDiscussionInput: UpdateDiscussionInput;
  UpdateDiscussionPayload: Omit<UpdateDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversParentTypes['Discussion']> };
  DeleteDiscussionInput: DeleteDiscussionInput;
  DeleteDiscussionPayload: Omit<DeleteDiscussionPayload, 'discussion'> & { discussion?: Maybe<ResolversParentTypes['Discussion']> };
  UpdateDiscussionCommentInput: UpdateDiscussionCommentInput;
  UpdateDiscussionCommentPayload: Omit<UpdateDiscussionCommentPayload, 'comment'> & { comment?: Maybe<ResolversParentTypes['DiscussionComment']> };
  DeleteDiscussionCommentInput: DeleteDiscussionCommentInput;
  DeleteDiscussionCommentPayload: Omit<DeleteDiscussionCommentPayload, 'comment'> & { comment?: Maybe<ResolversParentTypes['DiscussionComment']> };
  Gist: GistNode;
  GistFile: GistFileNode;
  GistComment: GistCommentNode;
  GistConnection: Omit<GistConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['GistEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['Gist']>>> };
  GistEdge: Omit<GistEdge, 'node'> & { node?: Maybe<ResolversParentTypes['Gist']> };
  GistCommentConnection: Omit<GistCommentConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['GistCommentEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['GistComment']>>> };
  GistCommentEdge: Omit<GistCommentEdge, 'node'> & { node?: Maybe<ResolversParentTypes['GistComment']> };
  GistOrder: GistOrder;
  Language: LanguageNode;
  StargazerConnection: Omit<StargazerConnection, 'edges' | 'nodes'> & { edges?: Maybe<Array<Maybe<ResolversParentTypes['StargazerEdge']>>>, nodes?: Maybe<Array<Maybe<ResolversParentTypes['User']>>> };
  StargazerEdge: Omit<StargazerEdge, 'node'> & { node: ResolversParentTypes['User'] };
  StarOrder: StarOrder;
};

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  viewer?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Node']>, ParentType, ContextType, RequireFields<QueryNodeArgs, 'id'>>;
  nodes?: Resolver<Array<Maybe<ResolversTypes['Node']>>, ParentType, ContextType, RequireFields<QueryNodesArgs, 'ids'>>;
  rateLimit?: Resolver<Maybe<ResolversTypes['RateLimit']>, ParentType, ContextType>;
  repository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType, RequireFields<QueryRepositoryArgs, 'name' | 'owner'>>;
  repositoryOwner?: Resolver<Maybe<ResolversTypes['RepositoryOwner']>, ParentType, ContextType, RequireFields<QueryRepositoryOwnerArgs, 'login'>>;
  user?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType, RequireFields<QueryUserArgs, 'login'>>;
  organization?: Resolver<Maybe<ResolversTypes['Organization']>, ParentType, ContextType, RequireFields<QueryOrganizationArgs, 'login'>>;
  search?: Resolver<ResolversTypes['SearchResultItemConnection'], ParentType, ContextType, RequireFields<QuerySearchArgs, 'query' | 'type'>>;
  resource?: Resolver<Maybe<ResolversTypes['UniformResourceLocatable']>, ParentType, ContextType, RequireFields<QueryResourceArgs, 'url'>>;
};

export type NodeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Node'] = ResolversParentTypes['Node']> = {
  __resolveType: TypeResolveFn<'User' | 'Repository' | 'Ref' | 'Commit' | 'Release' | 'ReleaseAsset' | 'Organization' | 'Team' | 'Issue' | 'Milestone' | 'IssueType' | 'PullRequest' | 'PullRequestReview' | 'Label' | 'IssueComment' | 'ProjectV2' | 'ProjectV2Field' | 'ProjectV2SingleSelectField' | 'ProjectV2Item' | 'DraftIssue' | 'ProjectV2ItemFieldTextValue' | 'ProjectV2ItemFieldNumberValue' | 'ProjectV2ItemFieldDateValue' | 'ProjectV2ItemFieldSingleSelectValue' | 'ProjectV2ItemFieldIterationValue' | 'Discussion' | 'DiscussionCategory' | 'DiscussionComment' | 'Gist' | 'GistComment' | 'Language', ParentType, ContextType>;
};

export type PageInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = {
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasPreviousPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  startCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type RateLimitResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RateLimit'] = ResolversParentTypes['RateLimit']> = {
  cost?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  limit?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  nodeCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  remaining?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  resetAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  used?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type UniformResourceLocatableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UniformResourceLocatable'] = ResolversParentTypes['UniformResourceLocatable']> = {
  __resolveType: TypeResolveFn<'User' | 'Repository' | 'Release' | 'Organization' | 'Issue' | 'PullRequest' | 'Gist', ParentType, ContextType>;
};

export type ActorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Actor'] = ResolversParentTypes['Actor']> = {
  __resolveType: TypeResolveFn<'User' | 'Organization', ParentType, ContextType>;
};

export type UserResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User']> = {
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  login?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  repositories?: Resolver<ResolversTypes['RepositoryConnection'], ParentType, ContextType, RequireFields<UserRepositoriesArgs, 'ownerAffiliations'>>;
  repository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType, RequireFields<UserRepositoryArgs, 'name'>>;
  projectsV2?: Resolver<ResolversTypes['ProjectV2Connection'], ParentType, ContextType, RequireFields<UserProjectsV2Args, 'minPermissionLevel' | 'orderBy'>>;
  projectV2?: Resolver<Maybe<ResolversTypes['ProjectV2']>, ParentType, ContextType, RequireFields<UserProjectV2Args, 'number'>>;
  gists?: Resolver<ResolversTypes['GistConnection'], ParentType, ContextType, Partial<UserGistsArgs>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export interface UriScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['URI'], any> {
  name: 'URI';
}

export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  createRepository?: Resolver<Maybe<ResolversTypes['CreateRepositoryPayload']>, ParentType, ContextType, RequireFields<MutationCreateRepositoryArgs, 'input'>>;
  updateRepository?: Resolver<Maybe<ResolversTypes['UpdateRepositoryPayload']>, ParentType, ContextType, RequireFields<MutationUpdateRepositoryArgs, 'input'>>;
  createLabel?: Resolver<Maybe<ResolversTypes['CreateLabelPayload']>, ParentType, ContextType, RequireFields<MutationCreateLabelArgs, 'input'>>;
  updateLabel?: Resolver<Maybe<ResolversTypes['UpdateLabelPayload']>, ParentType, ContextType, RequireFields<MutationUpdateLabelArgs, 'input'>>;
  deleteLabel?: Resolver<Maybe<ResolversTypes['DeleteLabelPayload']>, ParentType, ContextType, RequireFields<MutationDeleteLabelArgs, 'input'>>;
  createIssue?: Resolver<Maybe<ResolversTypes['CreateIssuePayload']>, ParentType, ContextType, RequireFields<MutationCreateIssueArgs, 'input'>>;
  updateIssue?: Resolver<Maybe<ResolversTypes['UpdateIssuePayload']>, ParentType, ContextType, RequireFields<MutationUpdateIssueArgs, 'input'>>;
  closeIssue?: Resolver<Maybe<ResolversTypes['CloseIssuePayload']>, ParentType, ContextType, RequireFields<MutationCloseIssueArgs, 'input'>>;
  reopenIssue?: Resolver<Maybe<ResolversTypes['ReopenIssuePayload']>, ParentType, ContextType, RequireFields<MutationReopenIssueArgs, 'input'>>;
  addLabelsToLabelable?: Resolver<Maybe<ResolversTypes['AddLabelsToLabelablePayload']>, ParentType, ContextType, RequireFields<MutationAddLabelsToLabelableArgs, 'input'>>;
  removeLabelsFromLabelable?: Resolver<Maybe<ResolversTypes['RemoveLabelsFromLabelablePayload']>, ParentType, ContextType, RequireFields<MutationRemoveLabelsFromLabelableArgs, 'input'>>;
  addAssigneesToAssignable?: Resolver<Maybe<ResolversTypes['AddAssigneesToAssignablePayload']>, ParentType, ContextType, RequireFields<MutationAddAssigneesToAssignableArgs, 'input'>>;
  removeAssigneesFromAssignable?: Resolver<Maybe<ResolversTypes['RemoveAssigneesFromAssignablePayload']>, ParentType, ContextType, RequireFields<MutationRemoveAssigneesFromAssignableArgs, 'input'>>;
  addComment?: Resolver<Maybe<ResolversTypes['AddCommentPayload']>, ParentType, ContextType, RequireFields<MutationAddCommentArgs, 'input'>>;
  createPullRequest?: Resolver<Maybe<ResolversTypes['CreatePullRequestPayload']>, ParentType, ContextType, RequireFields<MutationCreatePullRequestArgs, 'input'>>;
  markPullRequestReadyForReview?: Resolver<Maybe<ResolversTypes['MarkPullRequestReadyForReviewPayload']>, ParentType, ContextType, RequireFields<MutationMarkPullRequestReadyForReviewArgs, 'input'>>;
  convertPullRequestToDraft?: Resolver<Maybe<ResolversTypes['ConvertPullRequestToDraftPayload']>, ParentType, ContextType, RequireFields<MutationConvertPullRequestToDraftArgs, 'input'>>;
  closePullRequest?: Resolver<Maybe<ResolversTypes['ClosePullRequestPayload']>, ParentType, ContextType, RequireFields<MutationClosePullRequestArgs, 'input'>>;
  reopenPullRequest?: Resolver<Maybe<ResolversTypes['ReopenPullRequestPayload']>, ParentType, ContextType, RequireFields<MutationReopenPullRequestArgs, 'input'>>;
  updatePullRequest?: Resolver<Maybe<ResolversTypes['UpdatePullRequestPayload']>, ParentType, ContextType, RequireFields<MutationUpdatePullRequestArgs, 'input'>>;
  mergePullRequest?: Resolver<Maybe<ResolversTypes['MergePullRequestPayload']>, ParentType, ContextType, RequireFields<MutationMergePullRequestArgs, 'input'>>;
  addPullRequestReview?: Resolver<Maybe<ResolversTypes['AddPullRequestReviewPayload']>, ParentType, ContextType, RequireFields<MutationAddPullRequestReviewArgs, 'input'>>;
  createProjectV2?: Resolver<Maybe<ResolversTypes['CreateProjectV2Payload']>, ParentType, ContextType, RequireFields<MutationCreateProjectV2Args, 'input'>>;
  addProjectV2ItemById?: Resolver<Maybe<ResolversTypes['AddProjectV2ItemByIdPayload']>, ParentType, ContextType, RequireFields<MutationAddProjectV2ItemByIdArgs, 'input'>>;
  addProjectV2DraftIssue?: Resolver<Maybe<ResolversTypes['AddProjectV2DraftIssuePayload']>, ParentType, ContextType, RequireFields<MutationAddProjectV2DraftIssueArgs, 'input'>>;
  updateProjectV2DraftIssue?: Resolver<Maybe<ResolversTypes['UpdateProjectV2DraftIssuePayload']>, ParentType, ContextType, RequireFields<MutationUpdateProjectV2DraftIssueArgs, 'input'>>;
  updateProjectV2ItemFieldValue?: Resolver<Maybe<ResolversTypes['UpdateProjectV2ItemFieldValuePayload']>, ParentType, ContextType, RequireFields<MutationUpdateProjectV2ItemFieldValueArgs, 'input'>>;
  clearProjectV2ItemFieldValue?: Resolver<Maybe<ResolversTypes['ClearProjectV2ItemFieldValuePayload']>, ParentType, ContextType, RequireFields<MutationClearProjectV2ItemFieldValueArgs, 'input'>>;
  createProjectV2Field?: Resolver<Maybe<ResolversTypes['CreateProjectV2FieldPayload']>, ParentType, ContextType, RequireFields<MutationCreateProjectV2FieldArgs, 'input'>>;
  createDiscussion?: Resolver<Maybe<ResolversTypes['CreateDiscussionPayload']>, ParentType, ContextType, RequireFields<MutationCreateDiscussionArgs, 'input'>>;
  addDiscussionComment?: Resolver<Maybe<ResolversTypes['AddDiscussionCommentPayload']>, ParentType, ContextType, RequireFields<MutationAddDiscussionCommentArgs, 'input'>>;
  markDiscussionCommentAsAnswer?: Resolver<Maybe<ResolversTypes['MarkDiscussionCommentAsAnswerPayload']>, ParentType, ContextType, RequireFields<MutationMarkDiscussionCommentAsAnswerArgs, 'input'>>;
  unmarkDiscussionCommentAsAnswer?: Resolver<Maybe<ResolversTypes['UnmarkDiscussionCommentAsAnswerPayload']>, ParentType, ContextType, RequireFields<MutationUnmarkDiscussionCommentAsAnswerArgs, 'input'>>;
  addUpvote?: Resolver<Maybe<ResolversTypes['AddUpvotePayload']>, ParentType, ContextType, RequireFields<MutationAddUpvoteArgs, 'input'>>;
  removeUpvote?: Resolver<Maybe<ResolversTypes['RemoveUpvotePayload']>, ParentType, ContextType, RequireFields<MutationRemoveUpvoteArgs, 'input'>>;
  closeDiscussion?: Resolver<Maybe<ResolversTypes['CloseDiscussionPayload']>, ParentType, ContextType, RequireFields<MutationCloseDiscussionArgs, 'input'>>;
  reopenDiscussion?: Resolver<Maybe<ResolversTypes['ReopenDiscussionPayload']>, ParentType, ContextType, RequireFields<MutationReopenDiscussionArgs, 'input'>>;
  updateDiscussion?: Resolver<Maybe<ResolversTypes['UpdateDiscussionPayload']>, ParentType, ContextType, RequireFields<MutationUpdateDiscussionArgs, 'input'>>;
  deleteDiscussion?: Resolver<Maybe<ResolversTypes['DeleteDiscussionPayload']>, ParentType, ContextType, RequireFields<MutationDeleteDiscussionArgs, 'input'>>;
  updateDiscussionComment?: Resolver<Maybe<ResolversTypes['UpdateDiscussionCommentPayload']>, ParentType, ContextType, RequireFields<MutationUpdateDiscussionCommentArgs, 'input'>>;
  deleteDiscussionComment?: Resolver<Maybe<ResolversTypes['DeleteDiscussionCommentPayload']>, ParentType, ContextType, RequireFields<MutationDeleteDiscussionCommentArgs, 'input'>>;
};

export type RepositoryOwnerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RepositoryOwner'] = ResolversParentTypes['RepositoryOwner']> = {
  __resolveType: TypeResolveFn<'User' | 'Organization', ParentType, ContextType>;
};

export type RepositoryInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RepositoryInfo'] = ResolversParentTypes['RepositoryInfo']> = {
  __resolveType: TypeResolveFn<'Repository', ParentType, ContextType>;
};

export type StarrableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Starrable'] = ResolversParentTypes['Starrable']> = {
  __resolveType: TypeResolveFn<'Repository' | 'Gist', ParentType, ContextType>;
};

export type RepositoryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Repository'] = ResolversParentTypes['Repository']> = {
  archivedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  defaultBranchRef?: Resolver<Maybe<ResolversTypes['Ref']>, ParentType, ContextType>;
  deleteBranchOnMerge?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  forkCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  hasDiscussionsEnabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasIssuesEnabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasProjectsEnabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasWikiEnabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  homepageUrl?: Resolver<Maybe<ResolversTypes['URI']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isArchived?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isEmpty?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isFork?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isInOrganization?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isLocked?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isMirror?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isPrivate?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isTemplate?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  issueTemplates?: Resolver<Maybe<Array<ResolversTypes['IssueTemplate']>>, ParentType, ContextType>;
  latestRelease?: Resolver<Maybe<ResolversTypes['Release']>, ParentType, ContextType>;
  mergeCommitAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  mirrorUrl?: Resolver<Maybe<ResolversTypes['URI']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nameWithOwner?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  forks?: Resolver<ResolversTypes['RepositoryConnection'], ParentType, ContextType, Partial<RepositoryForksArgs>>;
  object?: Resolver<Maybe<ResolversTypes['GitObject']>, ParentType, ContextType, Partial<RepositoryObjectArgs>>;
  owner?: Resolver<ResolversTypes['RepositoryOwner'], ParentType, ContextType>;
  parent?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
  pullRequestTemplates?: Resolver<Maybe<Array<ResolversTypes['PullRequestTemplate']>>, ParentType, ContextType>;
  pushedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  rebaseMergeAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  ref?: Resolver<Maybe<ResolversTypes['Ref']>, ParentType, ContextType, RequireFields<RepositoryRefArgs, 'qualifiedName'>>;
  release?: Resolver<Maybe<ResolversTypes['Release']>, ParentType, ContextType, RequireFields<RepositoryReleaseArgs, 'tagName'>>;
  releases?: Resolver<ResolversTypes['ReleaseConnection'], ParentType, ContextType, Partial<RepositoryReleasesArgs>>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  squashMergeAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  sshUrl?: Resolver<ResolversTypes['GitSSHRemote'], ParentType, ContextType>;
  stargazerCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  templateRepository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  viewerCanAdminister?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerHasStarred?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerPermission?: Resolver<Maybe<ResolversTypes['RepositoryPermission']>, ParentType, ContextType>;
  visibility?: Resolver<ResolversTypes['RepositoryVisibility'], ParentType, ContextType>;
  labels?: Resolver<Maybe<ResolversTypes['LabelConnection']>, ParentType, ContextType, RequireFields<RepositoryLabelsArgs, 'orderBy'>>;
  issue?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType, RequireFields<RepositoryIssueArgs, 'number'>>;
  issueOrPullRequest?: Resolver<Maybe<ResolversTypes['IssueOrPullRequest']>, ParentType, ContextType, RequireFields<RepositoryIssueOrPullRequestArgs, 'number'>>;
  issues?: Resolver<ResolversTypes['IssueConnection'], ParentType, ContextType, Partial<RepositoryIssuesArgs>>;
  milestones?: Resolver<Maybe<ResolversTypes['MilestoneConnection']>, ParentType, ContextType, Partial<RepositoryMilestonesArgs>>;
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType, RequireFields<RepositoryPullRequestArgs, 'number'>>;
  pullRequests?: Resolver<ResolversTypes['PullRequestConnection'], ParentType, ContextType, Partial<RepositoryPullRequestsArgs>>;
  projectsV2?: Resolver<ResolversTypes['ProjectV2Connection'], ParentType, ContextType, RequireFields<RepositoryProjectsV2Args, 'minPermissionLevel' | 'orderBy'>>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType, RequireFields<RepositoryDiscussionArgs, 'number'>>;
  discussions?: Resolver<ResolversTypes['DiscussionConnection'], ParentType, ContextType, RequireFields<RepositoryDiscussionsArgs, 'answered' | 'categoryId' | 'orderBy'>>;
  discussionCategories?: Resolver<ResolversTypes['DiscussionCategoryConnection'], ParentType, ContextType, Partial<RepositoryDiscussionCategoriesArgs>>;
  discussionCategory?: Resolver<Maybe<ResolversTypes['DiscussionCategory']>, ParentType, ContextType, RequireFields<RepositoryDiscussionCategoryArgs, 'slug'>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type RepositoryConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RepositoryConnection'] = ResolversParentTypes['RepositoryConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['RepositoryEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Repository']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type RepositoryEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RepositoryEdge'] = ResolversParentTypes['RepositoryEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
};

export type RefResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Ref'] = ResolversParentTypes['Ref']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  prefix?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  target?: Resolver<Maybe<ResolversTypes['GitObject']>, ParentType, ContextType>;
  branchProtectionRule?: Resolver<Maybe<ResolversTypes['BranchProtectionRule']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type BranchProtectionRuleResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['BranchProtectionRule'] = ResolversParentTypes['BranchProtectionRule']> = {
  requiresStrictStatusChecks?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type GitObjectResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GitObject'] = ResolversParentTypes['GitObject']> = {
  __resolveType: TypeResolveFn<'Commit', ParentType, ContextType>;
};

export type CommitResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Commit'] = ResolversParentTypes['Commit']> = {
  abbreviatedOid?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  authoredDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  committedDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  messageHeadline?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  oid?: Resolver<ResolversTypes['GitObjectID'], ParentType, ContextType>;
  signature?: Resolver<Maybe<ResolversTypes['GitSignature']>, ParentType, ContextType>;
  repository?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  blame?: Resolver<ResolversTypes['Blame'], ParentType, ContextType, RequireFields<CommitBlameArgs, 'path'>>;
  zipballUrl?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  tarballUrl?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  statusCheckRollup?: Resolver<Maybe<ResolversTypes['StatusCheckRollup']>, ParentType, ContextType>;
  messageBody?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  authors?: Resolver<ResolversTypes['GitActorConnection'], ParentType, ContextType, Partial<CommitAuthorsArgs>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type BlameResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Blame'] = ResolversParentTypes['Blame']> = {
  ranges?: Resolver<Array<ResolversTypes['BlameRange']>, ParentType, ContextType>;
};

export type BlameRangeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['BlameRange'] = ResolversParentTypes['BlameRange']> = {
  age?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  commit?: Resolver<ResolversTypes['Commit'], ParentType, ContextType>;
  endingLine?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  startingLine?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export interface GitObjectIdScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['GitObjectID'], any> {
  name: 'GitObjectID';
}

export type CreateRepositoryPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreateRepositoryPayload'] = ResolversParentTypes['CreateRepositoryPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  repository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
};

export type UpdateRepositoryPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdateRepositoryPayload'] = ResolversParentTypes['UpdateRepositoryPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  repository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
};

export type CreateLabelPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreateLabelPayload'] = ResolversParentTypes['CreateLabelPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  label?: Resolver<Maybe<ResolversTypes['Label']>, ParentType, ContextType>;
};

export type UpdateLabelPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdateLabelPayload'] = ResolversParentTypes['UpdateLabelPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  label?: Resolver<Maybe<ResolversTypes['Label']>, ParentType, ContextType>;
};

export type DeleteLabelPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeleteLabelPayload'] = ResolversParentTypes['DeleteLabelPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export interface GitSshRemoteScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['GitSSHRemote'], any> {
  name: 'GitSSHRemote';
}

export type ReleaseResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Release'] = ResolversParentTypes['Release']> = {
  author?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  immutable?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isDraft?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isLatest?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isPrerelease?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  publishedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  releaseAssets?: Resolver<ResolversTypes['ReleaseAssetConnection'], ParentType, ContextType, Partial<ReleaseReleaseAssetsArgs>>;
  repository?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  tagName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  tagCommit?: Resolver<Maybe<ResolversTypes['Commit']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ReleaseAssetResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReleaseAsset'] = ResolversParentTypes['ReleaseAsset']> = {
  contentType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  downloadCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  downloadUrl?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  release?: Resolver<Maybe<ResolversTypes['Release']>, ParentType, ContextType>;
  size?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  uploadedBy?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ReleaseConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReleaseConnection'] = ResolversParentTypes['ReleaseConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['ReleaseEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Release']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ReleaseEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReleaseEdge'] = ResolversParentTypes['ReleaseEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Release']>, ParentType, ContextType>;
};

export type ReleaseAssetConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReleaseAssetConnection'] = ResolversParentTypes['ReleaseAssetConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['ReleaseAssetEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['ReleaseAsset']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ReleaseAssetEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReleaseAssetEdge'] = ResolversParentTypes['ReleaseAssetEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['ReleaseAsset']>, ParentType, ContextType>;
};

export type IssueTemplateResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IssueTemplate'] = ResolversParentTypes['IssueTemplate']> = {
  about?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  assignees?: Resolver<ResolversTypes['UserConnection'], ParentType, ContextType, Partial<IssueTemplateAssigneesArgs>>;
  body?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  filename?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  labels?: Resolver<Maybe<ResolversTypes['LabelConnection']>, ParentType, ContextType, Partial<IssueTemplateLabelsArgs>>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  title?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type PullRequestTemplateResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestTemplate'] = ResolversParentTypes['PullRequestTemplate']> = {
  body?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  filename?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  repository?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
};

export type GitSignatureResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GitSignature'] = ResolversParentTypes['GitSignature']> = {
  __resolveType: TypeResolveFn<'GpgSignature' | 'SshSignature', ParentType, ContextType>;
};

export type GpgSignatureResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GpgSignature'] = ResolversParentTypes['GpgSignature']> = {
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  isValid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  keyId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  payload?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  signature?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  signer?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['GitSignatureState'], ParentType, ContextType>;
  verifiedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  wasSignedByGitHub?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type SshSignatureResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SshSignature'] = ResolversParentTypes['SshSignature']> = {
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  isValid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  keyFingerprint?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  payload?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  signature?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  signer?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['GitSignatureState'], ParentType, ContextType>;
  verifiedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  wasSignedByGitHub?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type OrganizationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Organization'] = ResolversParentTypes['Organization']> = {
  avatarUrl?: Resolver<ResolversTypes['URI'], ParentType, ContextType, Partial<OrganizationAvatarUrlArgs>>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  email?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isVerified?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  location?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  login?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  repositories?: Resolver<ResolversTypes['RepositoryConnection'], ParentType, ContextType, RequireFields<OrganizationRepositoriesArgs, 'ownerAffiliations'>>;
  repository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType, RequireFields<OrganizationRepositoryArgs, 'name'>>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  websiteUrl?: Resolver<Maybe<ResolversTypes['URI']>, ParentType, ContextType>;
  teams?: Resolver<ResolversTypes['TeamConnection'], ParentType, ContextType, Partial<OrganizationTeamsArgs>>;
  projectV2?: Resolver<Maybe<ResolversTypes['ProjectV2']>, ParentType, ContextType, RequireFields<OrganizationProjectV2Args, 'number'>>;
  projectsV2?: Resolver<ResolversTypes['ProjectV2Connection'], ParentType, ContextType, RequireFields<OrganizationProjectsV2Args, 'minPermissionLevel' | 'orderBy'>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type OrganizationConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrganizationConnection'] = ResolversParentTypes['OrganizationConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['OrganizationEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Organization']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type OrganizationEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrganizationEdge'] = ResolversParentTypes['OrganizationEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Organization']>, ParentType, ContextType>;
};

export type TeamResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Team'] = ResolversParentTypes['Team']> = {
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  members?: Resolver<ResolversTypes['TeamMemberConnection'], ParentType, ContextType, Partial<TeamMembersArgs>>;
  notificationSetting?: Resolver<ResolversTypes['TeamNotificationSetting'], ParentType, ContextType>;
  organization?: Resolver<ResolversTypes['Organization'], ParentType, ContextType>;
  parentTeam?: Resolver<Maybe<ResolversTypes['Team']>, ParentType, ContextType>;
  privacy?: Resolver<ResolversTypes['TeamPrivacy'], ParentType, ContextType>;
  repositories?: Resolver<ResolversTypes['TeamRepositoryConnection'], ParentType, ContextType, Partial<TeamRepositoriesArgs>>;
  childTeams?: Resolver<ResolversTypes['TeamConnection'], ParentType, ContextType, RequireFields<TeamChildTeamsArgs, 'immediateOnly'>>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type TeamConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TeamConnection'] = ResolversParentTypes['TeamConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['TeamEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Team']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type TeamEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TeamEdge'] = ResolversParentTypes['TeamEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Team']>, ParentType, ContextType>;
};

export type TeamMemberConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TeamMemberConnection'] = ResolversParentTypes['TeamMemberConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['TeamMemberEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['User']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type TeamMemberEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TeamMemberEdge'] = ResolversParentTypes['TeamMemberEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  memberAccessResourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  memberAccessUrl?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['TeamMemberRole'], ParentType, ContextType>;
};

export type TeamRepositoryConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TeamRepositoryConnection'] = ResolversParentTypes['TeamRepositoryConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['TeamRepositoryEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Repository']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type TeamRepositoryEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TeamRepositoryEdge'] = ResolversParentTypes['TeamRepositoryEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
  permission?: Resolver<ResolversTypes['RepositoryPermission'], ParentType, ContextType>;
};

export type IssueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Issue'] = ResolversParentTypes['Issue']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['IssueState'], ParentType, ContextType>;
  stateReason?: Resolver<Maybe<ResolversTypes['IssueStateReason']>, ParentType, ContextType, RequireFields<IssueStateReasonArgs, 'enableDuplicate'>>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  closedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  closed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  author?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  repository?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
  milestone?: Resolver<Maybe<ResolversTypes['Milestone']>, ParentType, ContextType>;
  assignees?: Resolver<ResolversTypes['UserConnection'], ParentType, ContextType, Partial<IssueAssigneesArgs>>;
  labels?: Resolver<Maybe<ResolversTypes['LabelConnection']>, ParentType, ContextType, Partial<IssueLabelsArgs>>;
  comments?: Resolver<ResolversTypes['IssueCommentConnection'], ParentType, ContextType, Partial<IssueCommentsArgs>>;
  projectCards?: Resolver<ResolversTypes['ProjectCardConnection'], ParentType, ContextType, Partial<IssueProjectCardsArgs>>;
  reactionGroups?: Resolver<Maybe<Array<ResolversTypes['ReactionGroup']>>, ParentType, ContextType>;
  issueType?: Resolver<Maybe<ResolversTypes['IssueType']>, ParentType, ContextType>;
  parent?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
  subIssues?: Resolver<ResolversTypes['IssueConnection'], ParentType, ContextType, Partial<IssueSubIssuesArgs>>;
  subIssuesSummary?: Resolver<ResolversTypes['SubIssuesSummary'], ParentType, ContextType>;
  projectItems?: Resolver<Maybe<ResolversTypes['ProjectV2ItemConnection']>, ParentType, ContextType, RequireFields<IssueProjectItemsArgs, 'includeArchived'>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type IssueOrPullRequestResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IssueOrPullRequest'] = ResolversParentTypes['IssueOrPullRequest']> = {
  __resolveType: TypeResolveFn<'Issue' | 'PullRequest', ParentType, ContextType>;
};

export type MilestoneResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Milestone'] = ResolversParentTypes['Milestone']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  dueOn?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['MilestoneState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type MilestoneConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MilestoneConnection'] = ResolversParentTypes['MilestoneConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['MilestoneEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Milestone']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type MilestoneEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MilestoneEdge'] = ResolversParentTypes['MilestoneEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Milestone']>, ParentType, ContextType>;
};

export type ProjectCardConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectCardConnection'] = ResolversParentTypes['ProjectCardConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectCardEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectCard']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ProjectCardEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectCardEdge'] = ResolversParentTypes['ProjectCardEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['ProjectCard']>, ParentType, ContextType>;
};

export type ProjectCardResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectCard'] = ResolversParentTypes['ProjectCard']> = {
  project?: Resolver<ResolversTypes['Project'], ParentType, ContextType>;
  column?: Resolver<Maybe<ResolversTypes['ProjectColumn']>, ParentType, ContextType>;
};

export type ProjectResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Project'] = ResolversParentTypes['Project']> = {
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ProjectColumnResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectColumn'] = ResolversParentTypes['ProjectColumn']> = {
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type IssueConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IssueConnection'] = ResolversParentTypes['IssueConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['IssueEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Issue']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type IssueEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IssueEdge'] = ResolversParentTypes['IssueEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
};

export type IssueTypeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IssueType'] = ResolversParentTypes['IssueType']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  color?: Resolver<ResolversTypes['IssueTypeColor'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type SubIssuesSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SubIssuesSummary'] = ResolversParentTypes['SubIssuesSummary']> = {
  completed?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  percentCompleted?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type LabelableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Labelable'] = ResolversParentTypes['Labelable']> = {
  __resolveType: TypeResolveFn<'Issue' | 'Discussion', ParentType, ContextType>;
};

export type AssignableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Assignable'] = ResolversParentTypes['Assignable']> = {
  __resolveType: TypeResolveFn<'Issue', ParentType, ContextType>;
};

export type CreateIssuePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreateIssuePayload'] = ResolversParentTypes['CreateIssuePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  issue?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
};

export type UpdateIssuePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdateIssuePayload'] = ResolversParentTypes['UpdateIssuePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  issue?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
};

export type CloseIssuePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CloseIssuePayload'] = ResolversParentTypes['CloseIssuePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  issue?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
};

export type ReopenIssuePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReopenIssuePayload'] = ResolversParentTypes['ReopenIssuePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  issue?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
};

export type AddLabelsToLabelablePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AddLabelsToLabelablePayload'] = ResolversParentTypes['AddLabelsToLabelablePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  labelable?: Resolver<Maybe<ResolversTypes['Labelable']>, ParentType, ContextType>;
};

export type RemoveLabelsFromLabelablePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RemoveLabelsFromLabelablePayload'] = ResolversParentTypes['RemoveLabelsFromLabelablePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  labelable?: Resolver<Maybe<ResolversTypes['Labelable']>, ParentType, ContextType>;
};

export type AddAssigneesToAssignablePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AddAssigneesToAssignablePayload'] = ResolversParentTypes['AddAssigneesToAssignablePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  assignable?: Resolver<Maybe<ResolversTypes['Assignable']>, ParentType, ContextType>;
};

export type RemoveAssigneesFromAssignablePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RemoveAssigneesFromAssignablePayload'] = ResolversParentTypes['RemoveAssigneesFromAssignablePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  assignable?: Resolver<Maybe<ResolversTypes['Assignable']>, ParentType, ContextType>;
};

export type AddCommentPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AddCommentPayload'] = ResolversParentTypes['AddCommentPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  commentEdge?: Resolver<Maybe<ResolversTypes['IssueCommentEdge']>, ParentType, ContextType>;
  subject?: Resolver<Maybe<ResolversTypes['Node']>, ParentType, ContextType>;
};

export type SearchResultItemResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SearchResultItem'] = ResolversParentTypes['SearchResultItem']> = {
  __resolveType: TypeResolveFn<'Discussion' | 'Issue' | 'PullRequest' | 'Repository', ParentType, ContextType>;
};

export type SearchResultItemConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SearchResultItemConnection'] = ResolversParentTypes['SearchResultItemConnection']> = {
  discussionCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['SearchResultItemEdge']>>>, ParentType, ContextType>;
  issueCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['SearchResultItem']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  repositoryCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type SearchResultItemEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SearchResultItemEdge'] = ResolversParentTypes['SearchResultItemEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['SearchResultItem']>, ParentType, ContextType>;
};

export type PullRequestResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequest'] = ResolversParentTypes['PullRequest']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['PullRequestState'], ParentType, ContextType>;
  isDraft?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  closedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  mergedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  closed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  merged?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  author?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  repository?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
  headRefName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  headRefOid?: Resolver<ResolversTypes['GitObjectID'], ParentType, ContextType>;
  baseRefName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  headRepository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
  headRepositoryOwner?: Resolver<Maybe<ResolversTypes['RepositoryOwner']>, ParentType, ContextType>;
  isCrossRepository?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  autoMergeRequest?: Resolver<Maybe<ResolversTypes['AutoMergeRequest']>, ParentType, ContextType, RequireFields<PullRequestAutoMergeRequestArgs, 'includeStack'>>;
  maintainerCanModify?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  mergeable?: Resolver<ResolversTypes['MergeableState'], ParentType, ContextType>;
  mergeStateStatus?: Resolver<ResolversTypes['MergeStateStatus'], ParentType, ContextType>;
  reviewDecision?: Resolver<Maybe<ResolversTypes['PullRequestReviewDecision']>, ParentType, ContextType>;
  baseRef?: Resolver<Maybe<ResolversTypes['Ref']>, ParentType, ContextType>;
  additions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  deletions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  changedFiles?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  mergeCommit?: Resolver<Maybe<ResolversTypes['Commit']>, ParentType, ContextType>;
  mergedBy?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  files?: Resolver<Maybe<ResolversTypes['PullRequestChangedFileConnection']>, ParentType, ContextType, Partial<PullRequestFilesArgs>>;
  commits?: Resolver<ResolversTypes['PullRequestCommitConnection'], ParentType, ContextType, Partial<PullRequestCommitsArgs>>;
  reviewRequests?: Resolver<Maybe<ResolversTypes['ReviewRequestConnection']>, ParentType, ContextType, Partial<PullRequestReviewRequestsArgs>>;
  reviews?: Resolver<Maybe<ResolversTypes['PullRequestReviewConnection']>, ParentType, ContextType, Partial<PullRequestReviewsArgs>>;
  latestReviews?: Resolver<Maybe<ResolversTypes['PullRequestReviewConnection']>, ParentType, ContextType, Partial<PullRequestLatestReviewsArgs>>;
  projectCards?: Resolver<ResolversTypes['ProjectCardConnection'], ParentType, ContextType, Partial<PullRequestProjectCardsArgs>>;
  assignees?: Resolver<ResolversTypes['UserConnection'], ParentType, ContextType, Partial<PullRequestAssigneesArgs>>;
  labels?: Resolver<Maybe<ResolversTypes['LabelConnection']>, ParentType, ContextType, Partial<PullRequestLabelsArgs>>;
  milestone?: Resolver<Maybe<ResolversTypes['Milestone']>, ParentType, ContextType>;
  comments?: Resolver<ResolversTypes['IssueCommentConnection'], ParentType, ContextType, Partial<PullRequestCommentsArgs>>;
  reactionGroups?: Resolver<Maybe<Array<ResolversTypes['ReactionGroup']>>, ParentType, ContextType>;
  projectItems?: Resolver<Maybe<ResolversTypes['ProjectV2ItemConnection']>, ParentType, ContextType, RequireFields<PullRequestProjectItemsArgs, 'includeArchived'>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PullRequestConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestConnection'] = ResolversParentTypes['PullRequestConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['PullRequestEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['PullRequest']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type PullRequestEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestEdge'] = ResolversParentTypes['PullRequestEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType>;
};

export type CreatePullRequestPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreatePullRequestPayload'] = ResolversParentTypes['CreatePullRequestPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType>;
};

export type MarkPullRequestReadyForReviewPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MarkPullRequestReadyForReviewPayload'] = ResolversParentTypes['MarkPullRequestReadyForReviewPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType>;
};

export type ConvertPullRequestToDraftPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ConvertPullRequestToDraftPayload'] = ResolversParentTypes['ConvertPullRequestToDraftPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType>;
};

export type ClosePullRequestPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ClosePullRequestPayload'] = ResolversParentTypes['ClosePullRequestPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType>;
};

export type ReopenPullRequestPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReopenPullRequestPayload'] = ResolversParentTypes['ReopenPullRequestPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType>;
};

export type UpdatePullRequestPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdatePullRequestPayload'] = ResolversParentTypes['UpdatePullRequestPayload']> = {
  actor?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType>;
};

export type MergePullRequestPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MergePullRequestPayload'] = ResolversParentTypes['MergePullRequestPayload']> = {
  actor?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType>;
};

export type AddPullRequestReviewPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AddPullRequestReviewPayload'] = ResolversParentTypes['AddPullRequestReviewPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pullRequestReview?: Resolver<Maybe<ResolversTypes['PullRequestReview']>, ParentType, ContextType>;
};

export interface GitTimestampScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['GitTimestamp'], any> {
  name: 'GitTimestamp';
}

export type GitActorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GitActor'] = ResolversParentTypes['GitActor']> = {
  date?: Resolver<Maybe<ResolversTypes['GitTimestamp']>, ParentType, ContextType>;
  email?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  user?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
};

export type GitActorConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GitActorConnection'] = ResolversParentTypes['GitActorConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['GitActorEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['GitActor']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type GitActorEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GitActorEdge'] = ResolversParentTypes['GitActorEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['GitActor']>, ParentType, ContextType>;
};

export type PullRequestChangedFileResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestChangedFile'] = ResolversParentTypes['PullRequestChangedFile']> = {
  additions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  changeType?: Resolver<ResolversTypes['PatchStatus'], ParentType, ContextType>;
  deletions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  viewerViewedState?: Resolver<ResolversTypes['FileViewedState'], ParentType, ContextType>;
};

export type PullRequestChangedFileConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestChangedFileConnection'] = ResolversParentTypes['PullRequestChangedFileConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['PullRequestChangedFileEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['PullRequestChangedFile']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type PullRequestChangedFileEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestChangedFileEdge'] = ResolversParentTypes['PullRequestChangedFileEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['PullRequestChangedFile']>, ParentType, ContextType>;
};

export type AutoMergeRequestResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AutoMergeRequest'] = ResolversParentTypes['AutoMergeRequest']> = {
  authorEmail?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  commitBody?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  commitHeadline?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  mergeMethod?: Resolver<ResolversTypes['PullRequestMergeMethod'], ParentType, ContextType>;
  enabledAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  enabledBy?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
};

export type PullRequestCommitResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestCommit'] = ResolversParentTypes['PullRequestCommit']> = {
  commit?: Resolver<ResolversTypes['Commit'], ParentType, ContextType>;
};

export type PullRequestCommitConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestCommitConnection'] = ResolversParentTypes['PullRequestCommitConnection']> = {
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['PullRequestCommit']>>>, ParentType, ContextType>;
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['PullRequestCommitEdge']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type PullRequestCommitEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestCommitEdge'] = ResolversParentTypes['PullRequestCommitEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['PullRequestCommit']>, ParentType, ContextType>;
};

export type ReviewRequestResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReviewRequest'] = ResolversParentTypes['ReviewRequest']> = {
  requestedReviewer?: Resolver<Maybe<ResolversTypes['RequestedReviewer']>, ParentType, ContextType>;
};

export type RequestedReviewerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RequestedReviewer'] = ResolversParentTypes['RequestedReviewer']> = {
  __resolveType: TypeResolveFn<'Bot' | 'Team' | 'User', ParentType, ContextType>;
};

export type ReviewRequestConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReviewRequestConnection'] = ResolversParentTypes['ReviewRequestConnection']> = {
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['ReviewRequest']>>>, ParentType, ContextType>;
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['ReviewRequestEdge']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ReviewRequestEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReviewRequestEdge'] = ResolversParentTypes['ReviewRequestEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['ReviewRequest']>, ParentType, ContextType>;
};

export type BotResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Bot'] = ResolversParentTypes['Bot']> = {
  login?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PullRequestReviewResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestReview'] = ResolversParentTypes['PullRequestReview']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  author?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  authorAssociation?: Resolver<ResolversTypes['CommentAuthorAssociation'], ParentType, ContextType>;
  submittedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['PullRequestReviewState'], ParentType, ContextType>;
  commit?: Resolver<Maybe<ResolversTypes['Commit']>, ParentType, ContextType>;
  reactionGroups?: Resolver<Maybe<Array<ResolversTypes['ReactionGroup']>>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PullRequestReviewConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestReviewConnection'] = ResolversParentTypes['PullRequestReviewConnection']> = {
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['PullRequestReview']>>>, ParentType, ContextType>;
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['PullRequestReviewEdge']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type PullRequestReviewEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PullRequestReviewEdge'] = ResolversParentTypes['PullRequestReviewEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['PullRequestReview']>, ParentType, ContextType>;
};

export type UserConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UserConnection'] = ResolversParentTypes['UserConnection']> = {
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['User']>>>, ParentType, ContextType>;
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['UserEdge']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type UserEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UserEdge'] = ResolversParentTypes['UserEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
};

export type LabelResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Label'] = ResolversParentTypes['Label']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  color?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type LabelConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LabelConnection'] = ResolversParentTypes['LabelConnection']> = {
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Label']>>>, ParentType, ContextType>;
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['LabelEdge']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type LabelEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LabelEdge'] = ResolversParentTypes['LabelEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Label']>, ParentType, ContextType>;
};

export type IssueCommentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IssueComment'] = ResolversParentTypes['IssueComment']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  author?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  authorAssociation?: Resolver<ResolversTypes['CommentAuthorAssociation'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  includesCreatedEdit?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isMinimized?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  minimizedReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  reactionGroups?: Resolver<Maybe<Array<ResolversTypes['ReactionGroup']>>, ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  viewerDidAuthor?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type IssueCommentConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IssueCommentConnection'] = ResolversParentTypes['IssueCommentConnection']> = {
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['IssueComment']>>>, ParentType, ContextType>;
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['IssueCommentEdge']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type IssueCommentEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IssueCommentEdge'] = ResolversParentTypes['IssueCommentEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['IssueComment']>, ParentType, ContextType>;
};

export type ReactionGroupResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReactionGroup'] = ResolversParentTypes['ReactionGroup']> = {
  content?: Resolver<ResolversTypes['ReactionContent'], ParentType, ContextType>;
  users?: Resolver<ResolversTypes['ReactingUserConnection'], ParentType, ContextType>;
};

export type StatusCheckRollupResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StatusCheckRollup'] = ResolversParentTypes['StatusCheckRollup']> = {
  contexts?: Resolver<ResolversTypes['StatusCheckRollupContextConnection'], ParentType, ContextType, Partial<StatusCheckRollupContextsArgs>>;
};

export type StatusCheckRollupContextResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StatusCheckRollupContext'] = ResolversParentTypes['StatusCheckRollupContext']> = {
  __resolveType: TypeResolveFn<'CheckRun' | 'StatusContext', ParentType, ContextType>;
};

export type StatusCheckRollupContextConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StatusCheckRollupContextConnection'] = ResolversParentTypes['StatusCheckRollupContextConnection']> = {
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['StatusCheckRollupContext']>>>, ParentType, ContextType>;
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['StatusCheckRollupContextEdge']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type StatusCheckRollupContextEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StatusCheckRollupContextEdge'] = ResolversParentTypes['StatusCheckRollupContextEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['StatusCheckRollupContext']>, ParentType, ContextType>;
};

export type StatusContextResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StatusContext'] = ResolversParentTypes['StatusContext']> = {
  context?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['StatusState'], ParentType, ContextType>;
  targetUrl?: Resolver<Maybe<ResolversTypes['URI']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CheckRunResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CheckRun'] = ResolversParentTypes['CheckRun']> = {
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  checkSuite?: Resolver<ResolversTypes['CheckSuite'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['CheckStatusState'], ParentType, ContextType>;
  conclusion?: Resolver<Maybe<ResolversTypes['CheckConclusionState']>, ParentType, ContextType>;
  startedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  completedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  detailsUrl?: Resolver<Maybe<ResolversTypes['URI']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CheckSuiteResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CheckSuite'] = ResolversParentTypes['CheckSuite']> = {
  workflowRun?: Resolver<Maybe<ResolversTypes['WorkflowRun']>, ParentType, ContextType>;
};

export type WorkflowRunResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['WorkflowRun'] = ResolversParentTypes['WorkflowRun']> = {
  workflow?: Resolver<ResolversTypes['Workflow'], ParentType, ContextType>;
};

export type WorkflowResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Workflow'] = ResolversParentTypes['Workflow']> = {
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ReactingUserConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReactingUserConnection'] = ResolversParentTypes['ReactingUserConnection']> = {
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ProjectV2Resolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2'] = ResolversParentTypes['ProjectV2']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  shortDescription?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  readme?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  public?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  closed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  owner?: Resolver<ResolversTypes['ProjectV2Owner'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  closedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  items?: Resolver<ResolversTypes['ProjectV2ItemConnection'], ParentType, ContextType, RequireFields<ProjectV2ItemsArgs, 'archivedStates' | 'orderBy' | 'query'>>;
  fields?: Resolver<ResolversTypes['ProjectV2FieldConfigurationConnection'], ParentType, ContextType, RequireFields<ProjectV2FieldsArgs, 'orderBy'>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2OwnerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2Owner'] = ResolversParentTypes['ProjectV2Owner']> = {
  __resolveType: TypeResolveFn<'User' | 'Organization', ParentType, ContextType>;
};

export type ProjectV2ConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2Connection'] = ResolversParentTypes['ProjectV2Connection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectV2Edge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectV2']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ProjectV2EdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2Edge'] = ResolversParentTypes['ProjectV2Edge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['ProjectV2']>, ParentType, ContextType>;
};

export type ProjectV2FieldCommonResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2FieldCommon'] = ResolversParentTypes['ProjectV2FieldCommon']> = {
  __resolveType: TypeResolveFn<'ProjectV2Field' | 'ProjectV2SingleSelectField', ParentType, ContextType>;
};

export type ProjectV2FieldResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2Field'] = ResolversParentTypes['ProjectV2Field']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dataType?: Resolver<ResolversTypes['ProjectV2FieldType'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  isIssueField?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  project?: Resolver<ResolversTypes['ProjectV2'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2SingleSelectFieldResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2SingleSelectField'] = ResolversParentTypes['ProjectV2SingleSelectField']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dataType?: Resolver<ResolversTypes['ProjectV2FieldType'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  isIssueField?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  options?: Resolver<Array<ResolversTypes['ProjectV2SingleSelectFieldOption']>, ParentType, ContextType, Partial<ProjectV2SingleSelectFieldOptionsArgs>>;
  project?: Resolver<ResolversTypes['ProjectV2'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2FieldConfigurationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2FieldConfiguration'] = ResolversParentTypes['ProjectV2FieldConfiguration']> = {
  __resolveType: TypeResolveFn<'ProjectV2Field' | 'ProjectV2IterationField' | 'ProjectV2SingleSelectField', ParentType, ContextType>;
};

export type ProjectV2FieldConfigurationConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2FieldConfigurationConnection'] = ResolversParentTypes['ProjectV2FieldConfigurationConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectV2FieldConfigurationEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectV2FieldConfiguration']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ProjectV2FieldConfigurationEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2FieldConfigurationEdge'] = ResolversParentTypes['ProjectV2FieldConfigurationEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['ProjectV2FieldConfiguration']>, ParentType, ContextType>;
};

export type ProjectV2SingleSelectFieldOptionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2SingleSelectFieldOption'] = ResolversParentTypes['ProjectV2SingleSelectFieldOption']> = {
  color?: Resolver<ResolversTypes['ProjectV2SingleSelectFieldOptionColor'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  descriptionHTML?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nameHTML?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ProjectV2ItemResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2Item'] = ResolversParentTypes['ProjectV2Item']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  project?: Resolver<ResolversTypes['ProjectV2'], ParentType, ContextType>;
  content?: Resolver<Maybe<ResolversTypes['ProjectV2ItemContent']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['ProjectV2ItemType'], ParentType, ContextType>;
  isArchived?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  fieldValues?: Resolver<ResolversTypes['ProjectV2ItemFieldValueConnection'], ParentType, ContextType, RequireFields<ProjectV2ItemFieldValuesArgs, 'orderBy'>>;
  fieldValueByName?: Resolver<Maybe<ResolversTypes['ProjectV2ItemFieldValue']>, ParentType, ContextType, RequireFields<ProjectV2ItemFieldValueByNameArgs, 'name'>>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemConnection'] = ResolversParentTypes['ProjectV2ItemConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectV2ItemEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectV2Item']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ProjectV2ItemEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemEdge'] = ResolversParentTypes['ProjectV2ItemEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['ProjectV2Item']>, ParentType, ContextType>;
};

export type ProjectV2ItemContentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemContent'] = ResolversParentTypes['ProjectV2ItemContent']> = {
  __resolveType: TypeResolveFn<'DraftIssue' | 'Issue' | 'PullRequest', ParentType, ContextType>;
};

export type DraftIssueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DraftIssue'] = ResolversParentTypes['DraftIssue']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldValue'] = ResolversParentTypes['ProjectV2ItemFieldValue']> = {
  __resolveType: TypeResolveFn<'ProjectV2ItemFieldDateValue' | 'ProjectV2ItemFieldIterationValue' | 'ProjectV2ItemFieldLabelValue' | 'ProjectV2ItemFieldMilestoneValue' | 'ProjectV2ItemFieldNumberValue' | 'ProjectV2ItemFieldPullRequestValue' | 'ProjectV2ItemFieldRepositoryValue' | 'ProjectV2ItemFieldReviewerValue' | 'ProjectV2ItemFieldSingleSelectValue' | 'ProjectV2ItemFieldTextValue' | 'ProjectV2ItemFieldUserValue', ParentType, ContextType>;
};

export type ProjectV2ItemFieldValueConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldValueConnection'] = ResolversParentTypes['ProjectV2ItemFieldValueConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectV2ItemFieldValueEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['ProjectV2ItemFieldValue']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ProjectV2ItemFieldValueEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldValueEdge'] = ResolversParentTypes['ProjectV2ItemFieldValueEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['ProjectV2ItemFieldValue']>, ParentType, ContextType>;
};

export type ProjectV2ItemFieldTextValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldTextValue'] = ResolversParentTypes['ProjectV2ItemFieldTextValue']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  text?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldNumberValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldNumberValue'] = ResolversParentTypes['ProjectV2ItemFieldNumberValue']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  number?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldDateValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldDateValue'] = ResolversParentTypes['ProjectV2ItemFieldDateValue']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  date?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldSingleSelectValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldSingleSelectValue'] = ResolversParentTypes['ProjectV2ItemFieldSingleSelectValue']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  optionId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  color?: Resolver<ResolversTypes['ProjectV2SingleSelectFieldOptionColor'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CreateProjectV2PayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreateProjectV2Payload'] = ResolversParentTypes['CreateProjectV2Payload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  projectV2?: Resolver<Maybe<ResolversTypes['ProjectV2']>, ParentType, ContextType>;
};

export type AddProjectV2ItemByIdPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AddProjectV2ItemByIdPayload'] = ResolversParentTypes['AddProjectV2ItemByIdPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  item?: Resolver<Maybe<ResolversTypes['ProjectV2Item']>, ParentType, ContextType>;
};

export type AddProjectV2DraftIssuePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AddProjectV2DraftIssuePayload'] = ResolversParentTypes['AddProjectV2DraftIssuePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  projectItem?: Resolver<Maybe<ResolversTypes['ProjectV2Item']>, ParentType, ContextType>;
};

export type UpdateProjectV2DraftIssuePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdateProjectV2DraftIssuePayload'] = ResolversParentTypes['UpdateProjectV2DraftIssuePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  draftIssue?: Resolver<Maybe<ResolversTypes['DraftIssue']>, ParentType, ContextType>;
};

export type UpdateProjectV2ItemFieldValuePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdateProjectV2ItemFieldValuePayload'] = ResolversParentTypes['UpdateProjectV2ItemFieldValuePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  projectV2Item?: Resolver<Maybe<ResolversTypes['ProjectV2Item']>, ParentType, ContextType>;
};

export type ClearProjectV2ItemFieldValuePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ClearProjectV2ItemFieldValuePayload'] = ResolversParentTypes['ClearProjectV2ItemFieldValuePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  projectV2Item?: Resolver<Maybe<ResolversTypes['ProjectV2Item']>, ParentType, ContextType>;
};

export type CreateProjectV2FieldPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreateProjectV2FieldPayload'] = ResolversParentTypes['CreateProjectV2FieldPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  projectV2Field?: Resolver<Maybe<ResolversTypes['ProjectV2FieldConfiguration']>, ParentType, ContextType>;
};

export interface DateScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
  name: 'Date';
}

export type ProjectV2IterationFieldResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2IterationField'] = ResolversParentTypes['ProjectV2IterationField']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dataType?: Resolver<ResolversTypes['ProjectV2FieldType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldIterationValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldIterationValue'] = ResolversParentTypes['ProjectV2ItemFieldIterationValue']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  iterationId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  startDate?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  duration?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldLabelValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldLabelValue'] = ResolversParentTypes['ProjectV2ItemFieldLabelValue']> = {
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  labels?: Resolver<Maybe<ResolversTypes['LabelConnection']>, ParentType, ContextType, Partial<ProjectV2ItemFieldLabelValueLabelsArgs>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldMilestoneValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldMilestoneValue'] = ResolversParentTypes['ProjectV2ItemFieldMilestoneValue']> = {
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  milestone?: Resolver<Maybe<ResolversTypes['Milestone']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldPullRequestValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldPullRequestValue'] = ResolversParentTypes['ProjectV2ItemFieldPullRequestValue']> = {
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  pullRequests?: Resolver<Maybe<ResolversTypes['PullRequestConnection']>, ParentType, ContextType, RequireFields<ProjectV2ItemFieldPullRequestValuePullRequestsArgs, 'orderBy'>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldRepositoryValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldRepositoryValue'] = ResolversParentTypes['ProjectV2ItemFieldRepositoryValue']> = {
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  repository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldReviewerValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldReviewerValue'] = ResolversParentTypes['ProjectV2ItemFieldReviewerValue']> = {
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  reviewers?: Resolver<Maybe<ResolversTypes['RequestedReviewerConnection']>, ParentType, ContextType, Partial<ProjectV2ItemFieldReviewerValueReviewersArgs>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ProjectV2ItemFieldUserValueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectV2ItemFieldUserValue'] = ResolversParentTypes['ProjectV2ItemFieldUserValue']> = {
  field?: Resolver<ResolversTypes['ProjectV2FieldConfiguration'], ParentType, ContextType>;
  users?: Resolver<Maybe<ResolversTypes['UserConnection']>, ParentType, ContextType, Partial<ProjectV2ItemFieldUserValueUsersArgs>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type RequestedReviewerConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RequestedReviewerConnection'] = ResolversParentTypes['RequestedReviewerConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['RequestedReviewerEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['RequestedReviewer']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type RequestedReviewerEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RequestedReviewerEdge'] = ResolversParentTypes['RequestedReviewerEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['RequestedReviewer']>, ParentType, ContextType>;
};

export type DiscussionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Discussion'] = ResolversParentTypes['Discussion']> = {
  answer?: Resolver<Maybe<ResolversTypes['DiscussionComment']>, ParentType, ContextType>;
  answerChosenAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  answerChosenBy?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  author?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  authorAssociation?: Resolver<ResolversTypes['CommentAuthorAssociation'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  category?: Resolver<ResolversTypes['DiscussionCategory'], ParentType, ContextType>;
  closed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  closedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  comments?: Resolver<ResolversTypes['DiscussionCommentConnection'], ParentType, ContextType, Partial<DiscussionCommentsArgs>>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  createdViaEmail?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  includesCreatedEdit?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isAnswered?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  labels?: Resolver<Maybe<ResolversTypes['LabelConnection']>, ParentType, ContextType, Partial<DiscussionLabelsArgs>>;
  lastEditedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  locked?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  publishedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  reactionGroups?: Resolver<Maybe<Array<ResolversTypes['ReactionGroup']>>, ParentType, ContextType>;
  repository?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  stateReason?: Resolver<Maybe<ResolversTypes['DiscussionStateReason']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  upvoteCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  viewerCanClose?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanDelete?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanLabel?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanReact?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanReopen?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanSubscribe?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanUpdate?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanUpvote?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerDidAuthor?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerHasUpvoted?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DiscussionCategoryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DiscussionCategory'] = ResolversParentTypes['DiscussionCategory']> = {
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  emoji?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isAnswerable?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  repository?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DiscussionCommentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DiscussionComment'] = ResolversParentTypes['DiscussionComment']> = {
  author?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  authorAssociation?: Resolver<ResolversTypes['CommentAuthorAssociation'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  createdViaEmail?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  includesCreatedEdit?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isAnswer?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isMinimized?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  lastEditedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  minimizedReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  publishedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  reactionGroups?: Resolver<Maybe<Array<ResolversTypes['ReactionGroup']>>, ParentType, ContextType>;
  replies?: Resolver<ResolversTypes['DiscussionCommentConnection'], ParentType, ContextType, Partial<DiscussionCommentRepliesArgs>>;
  replyTo?: Resolver<Maybe<ResolversTypes['DiscussionComment']>, ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  upvoteCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  viewerCanDelete?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanMarkAsAnswer?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanMinimize?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanReact?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanUnmarkAsAnswer?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanUpdate?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanUpvote?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerDidAuthor?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerHasUpvoted?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DiscussionConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DiscussionConnection'] = ResolversParentTypes['DiscussionConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['DiscussionEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Discussion']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type DiscussionEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DiscussionEdge'] = ResolversParentTypes['DiscussionEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
};

export type DiscussionCategoryConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DiscussionCategoryConnection'] = ResolversParentTypes['DiscussionCategoryConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['DiscussionCategoryEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['DiscussionCategory']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type DiscussionCategoryEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DiscussionCategoryEdge'] = ResolversParentTypes['DiscussionCategoryEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['DiscussionCategory']>, ParentType, ContextType>;
};

export type DiscussionCommentConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DiscussionCommentConnection'] = ResolversParentTypes['DiscussionCommentConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['DiscussionCommentEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['DiscussionComment']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type DiscussionCommentEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DiscussionCommentEdge'] = ResolversParentTypes['DiscussionCommentEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['DiscussionComment']>, ParentType, ContextType>;
};

export type VotableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Votable'] = ResolversParentTypes['Votable']> = {
  __resolveType: TypeResolveFn<'Discussion' | 'DiscussionComment', ParentType, ContextType>;
};

export type CreateDiscussionPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreateDiscussionPayload'] = ResolversParentTypes['CreateDiscussionPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
};

export type AddDiscussionCommentPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AddDiscussionCommentPayload'] = ResolversParentTypes['AddDiscussionCommentPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  comment?: Resolver<Maybe<ResolversTypes['DiscussionComment']>, ParentType, ContextType>;
};

export type MarkDiscussionCommentAsAnswerPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MarkDiscussionCommentAsAnswerPayload'] = ResolversParentTypes['MarkDiscussionCommentAsAnswerPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
};

export type UnmarkDiscussionCommentAsAnswerPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UnmarkDiscussionCommentAsAnswerPayload'] = ResolversParentTypes['UnmarkDiscussionCommentAsAnswerPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
};

export type AddUpvotePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AddUpvotePayload'] = ResolversParentTypes['AddUpvotePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  subject?: Resolver<Maybe<ResolversTypes['Votable']>, ParentType, ContextType>;
};

export type RemoveUpvotePayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RemoveUpvotePayload'] = ResolversParentTypes['RemoveUpvotePayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  subject?: Resolver<Maybe<ResolversTypes['Votable']>, ParentType, ContextType>;
};

export type CloseDiscussionPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CloseDiscussionPayload'] = ResolversParentTypes['CloseDiscussionPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
};

export type ReopenDiscussionPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReopenDiscussionPayload'] = ResolversParentTypes['ReopenDiscussionPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
};

export type UpdateDiscussionPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdateDiscussionPayload'] = ResolversParentTypes['UpdateDiscussionPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
};

export type DeleteDiscussionPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeleteDiscussionPayload'] = ResolversParentTypes['DeleteDiscussionPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  discussion?: Resolver<Maybe<ResolversTypes['Discussion']>, ParentType, ContextType>;
};

export type UpdateDiscussionCommentPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdateDiscussionCommentPayload'] = ResolversParentTypes['UpdateDiscussionCommentPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  comment?: Resolver<Maybe<ResolversTypes['DiscussionComment']>, ParentType, ContextType>;
};

export type DeleteDiscussionCommentPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeleteDiscussionCommentPayload'] = ResolversParentTypes['DeleteDiscussionCommentPayload']> = {
  clientMutationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  comment?: Resolver<Maybe<ResolversTypes['DiscussionComment']>, ParentType, ContextType>;
};

export type GistResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Gist'] = ResolversParentTypes['Gist']> = {
  comments?: Resolver<ResolversTypes['GistCommentConnection'], ParentType, ContextType, Partial<GistCommentsArgs>>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  files?: Resolver<Maybe<Array<Maybe<ResolversTypes['GistFile']>>>, ParentType, ContextType, RequireFields<GistFilesArgs, 'limit'>>;
  forks?: Resolver<ResolversTypes['GistConnection'], ParentType, ContextType, Partial<GistForksArgs>>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isFork?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isPublic?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  owner?: Resolver<Maybe<ResolversTypes['RepositoryOwner']>, ParentType, ContextType>;
  pushedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  stargazerCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  stargazers?: Resolver<ResolversTypes['StargazerConnection'], ParentType, ContextType, Partial<GistStargazersArgs>>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  viewerHasStarred?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type GistFileResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GistFile'] = ResolversParentTypes['GistFile']> = {
  encodedName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  extension?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  isImage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isTruncated?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  language?: Resolver<Maybe<ResolversTypes['Language']>, ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  size?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  text?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType, Partial<GistFileTextArgs>>;
};

export type GistCommentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GistComment'] = ResolversParentTypes['GistComment']> = {
  author?: Resolver<Maybe<ResolversTypes['Actor']>, ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  bodyText?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  databaseId?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  gist?: Resolver<ResolversTypes['Gist'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  includesCreatedEdit?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  viewerCanDelete?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerCanUpdate?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerDidAuthor?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type GistConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GistConnection'] = ResolversParentTypes['GistConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['GistEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['Gist']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type GistEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GistEdge'] = ResolversParentTypes['GistEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Gist']>, ParentType, ContextType>;
};

export type GistCommentConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GistCommentConnection'] = ResolversParentTypes['GistCommentConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['GistCommentEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['GistComment']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type GistCommentEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['GistCommentEdge'] = ResolversParentTypes['GistCommentEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['GistComment']>, ParentType, ContextType>;
};

export type LanguageResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Language'] = ResolversParentTypes['Language']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type StargazerConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StargazerConnection'] = ResolversParentTypes['StargazerConnection']> = {
  edges?: Resolver<Maybe<Array<Maybe<ResolversTypes['StargazerEdge']>>>, ParentType, ContextType>;
  nodes?: Resolver<Maybe<Array<Maybe<ResolversTypes['User']>>>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type StargazerEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StargazerEdge'] = ResolversParentTypes['StargazerEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  starredAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
};

export type Resolvers<ContextType = GraphQLContext> = {
  Query?: QueryResolvers<ContextType>;
  Node?: NodeResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  RateLimit?: RateLimitResolvers<ContextType>;
  UniformResourceLocatable?: UniformResourceLocatableResolvers<ContextType>;
  Actor?: ActorResolvers<ContextType>;
  User?: UserResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  URI?: GraphQLScalarType;
  Mutation?: MutationResolvers<ContextType>;
  RepositoryOwner?: RepositoryOwnerResolvers<ContextType>;
  RepositoryInfo?: RepositoryInfoResolvers<ContextType>;
  Starrable?: StarrableResolvers<ContextType>;
  Repository?: RepositoryResolvers<ContextType>;
  RepositoryConnection?: RepositoryConnectionResolvers<ContextType>;
  RepositoryEdge?: RepositoryEdgeResolvers<ContextType>;
  Ref?: RefResolvers<ContextType>;
  BranchProtectionRule?: BranchProtectionRuleResolvers<ContextType>;
  GitObject?: GitObjectResolvers<ContextType>;
  Commit?: CommitResolvers<ContextType>;
  Blame?: BlameResolvers<ContextType>;
  BlameRange?: BlameRangeResolvers<ContextType>;
  GitObjectID?: GraphQLScalarType;
  CreateRepositoryPayload?: CreateRepositoryPayloadResolvers<ContextType>;
  UpdateRepositoryPayload?: UpdateRepositoryPayloadResolvers<ContextType>;
  CreateLabelPayload?: CreateLabelPayloadResolvers<ContextType>;
  UpdateLabelPayload?: UpdateLabelPayloadResolvers<ContextType>;
  DeleteLabelPayload?: DeleteLabelPayloadResolvers<ContextType>;
  GitSSHRemote?: GraphQLScalarType;
  Release?: ReleaseResolvers<ContextType>;
  ReleaseAsset?: ReleaseAssetResolvers<ContextType>;
  ReleaseConnection?: ReleaseConnectionResolvers<ContextType>;
  ReleaseEdge?: ReleaseEdgeResolvers<ContextType>;
  ReleaseAssetConnection?: ReleaseAssetConnectionResolvers<ContextType>;
  ReleaseAssetEdge?: ReleaseAssetEdgeResolvers<ContextType>;
  IssueTemplate?: IssueTemplateResolvers<ContextType>;
  PullRequestTemplate?: PullRequestTemplateResolvers<ContextType>;
  GitSignature?: GitSignatureResolvers<ContextType>;
  GpgSignature?: GpgSignatureResolvers<ContextType>;
  SshSignature?: SshSignatureResolvers<ContextType>;
  Organization?: OrganizationResolvers<ContextType>;
  OrganizationConnection?: OrganizationConnectionResolvers<ContextType>;
  OrganizationEdge?: OrganizationEdgeResolvers<ContextType>;
  Team?: TeamResolvers<ContextType>;
  TeamConnection?: TeamConnectionResolvers<ContextType>;
  TeamEdge?: TeamEdgeResolvers<ContextType>;
  TeamMemberConnection?: TeamMemberConnectionResolvers<ContextType>;
  TeamMemberEdge?: TeamMemberEdgeResolvers<ContextType>;
  TeamRepositoryConnection?: TeamRepositoryConnectionResolvers<ContextType>;
  TeamRepositoryEdge?: TeamRepositoryEdgeResolvers<ContextType>;
  Issue?: IssueResolvers<ContextType>;
  IssueOrPullRequest?: IssueOrPullRequestResolvers<ContextType>;
  Milestone?: MilestoneResolvers<ContextType>;
  MilestoneConnection?: MilestoneConnectionResolvers<ContextType>;
  MilestoneEdge?: MilestoneEdgeResolvers<ContextType>;
  ProjectCardConnection?: ProjectCardConnectionResolvers<ContextType>;
  ProjectCardEdge?: ProjectCardEdgeResolvers<ContextType>;
  ProjectCard?: ProjectCardResolvers<ContextType>;
  Project?: ProjectResolvers<ContextType>;
  ProjectColumn?: ProjectColumnResolvers<ContextType>;
  IssueConnection?: IssueConnectionResolvers<ContextType>;
  IssueEdge?: IssueEdgeResolvers<ContextType>;
  IssueType?: IssueTypeResolvers<ContextType>;
  SubIssuesSummary?: SubIssuesSummaryResolvers<ContextType>;
  Labelable?: LabelableResolvers<ContextType>;
  Assignable?: AssignableResolvers<ContextType>;
  CreateIssuePayload?: CreateIssuePayloadResolvers<ContextType>;
  UpdateIssuePayload?: UpdateIssuePayloadResolvers<ContextType>;
  CloseIssuePayload?: CloseIssuePayloadResolvers<ContextType>;
  ReopenIssuePayload?: ReopenIssuePayloadResolvers<ContextType>;
  AddLabelsToLabelablePayload?: AddLabelsToLabelablePayloadResolvers<ContextType>;
  RemoveLabelsFromLabelablePayload?: RemoveLabelsFromLabelablePayloadResolvers<ContextType>;
  AddAssigneesToAssignablePayload?: AddAssigneesToAssignablePayloadResolvers<ContextType>;
  RemoveAssigneesFromAssignablePayload?: RemoveAssigneesFromAssignablePayloadResolvers<ContextType>;
  AddCommentPayload?: AddCommentPayloadResolvers<ContextType>;
  SearchResultItem?: SearchResultItemResolvers<ContextType>;
  SearchResultItemConnection?: SearchResultItemConnectionResolvers<ContextType>;
  SearchResultItemEdge?: SearchResultItemEdgeResolvers<ContextType>;
  PullRequest?: PullRequestResolvers<ContextType>;
  PullRequestConnection?: PullRequestConnectionResolvers<ContextType>;
  PullRequestEdge?: PullRequestEdgeResolvers<ContextType>;
  CreatePullRequestPayload?: CreatePullRequestPayloadResolvers<ContextType>;
  MarkPullRequestReadyForReviewPayload?: MarkPullRequestReadyForReviewPayloadResolvers<ContextType>;
  ConvertPullRequestToDraftPayload?: ConvertPullRequestToDraftPayloadResolvers<ContextType>;
  ClosePullRequestPayload?: ClosePullRequestPayloadResolvers<ContextType>;
  ReopenPullRequestPayload?: ReopenPullRequestPayloadResolvers<ContextType>;
  UpdatePullRequestPayload?: UpdatePullRequestPayloadResolvers<ContextType>;
  MergePullRequestPayload?: MergePullRequestPayloadResolvers<ContextType>;
  AddPullRequestReviewPayload?: AddPullRequestReviewPayloadResolvers<ContextType>;
  GitTimestamp?: GraphQLScalarType;
  GitActor?: GitActorResolvers<ContextType>;
  GitActorConnection?: GitActorConnectionResolvers<ContextType>;
  GitActorEdge?: GitActorEdgeResolvers<ContextType>;
  PullRequestChangedFile?: PullRequestChangedFileResolvers<ContextType>;
  PullRequestChangedFileConnection?: PullRequestChangedFileConnectionResolvers<ContextType>;
  PullRequestChangedFileEdge?: PullRequestChangedFileEdgeResolvers<ContextType>;
  AutoMergeRequest?: AutoMergeRequestResolvers<ContextType>;
  PullRequestCommit?: PullRequestCommitResolvers<ContextType>;
  PullRequestCommitConnection?: PullRequestCommitConnectionResolvers<ContextType>;
  PullRequestCommitEdge?: PullRequestCommitEdgeResolvers<ContextType>;
  ReviewRequest?: ReviewRequestResolvers<ContextType>;
  RequestedReviewer?: RequestedReviewerResolvers<ContextType>;
  ReviewRequestConnection?: ReviewRequestConnectionResolvers<ContextType>;
  ReviewRequestEdge?: ReviewRequestEdgeResolvers<ContextType>;
  Bot?: BotResolvers<ContextType>;
  PullRequestReview?: PullRequestReviewResolvers<ContextType>;
  PullRequestReviewConnection?: PullRequestReviewConnectionResolvers<ContextType>;
  PullRequestReviewEdge?: PullRequestReviewEdgeResolvers<ContextType>;
  UserConnection?: UserConnectionResolvers<ContextType>;
  UserEdge?: UserEdgeResolvers<ContextType>;
  Label?: LabelResolvers<ContextType>;
  LabelConnection?: LabelConnectionResolvers<ContextType>;
  LabelEdge?: LabelEdgeResolvers<ContextType>;
  IssueComment?: IssueCommentResolvers<ContextType>;
  IssueCommentConnection?: IssueCommentConnectionResolvers<ContextType>;
  IssueCommentEdge?: IssueCommentEdgeResolvers<ContextType>;
  ReactionGroup?: ReactionGroupResolvers<ContextType>;
  StatusCheckRollup?: StatusCheckRollupResolvers<ContextType>;
  StatusCheckRollupContext?: StatusCheckRollupContextResolvers<ContextType>;
  StatusCheckRollupContextConnection?: StatusCheckRollupContextConnectionResolvers<ContextType>;
  StatusCheckRollupContextEdge?: StatusCheckRollupContextEdgeResolvers<ContextType>;
  StatusContext?: StatusContextResolvers<ContextType>;
  CheckRun?: CheckRunResolvers<ContextType>;
  CheckSuite?: CheckSuiteResolvers<ContextType>;
  WorkflowRun?: WorkflowRunResolvers<ContextType>;
  Workflow?: WorkflowResolvers<ContextType>;
  ReactingUserConnection?: ReactingUserConnectionResolvers<ContextType>;
  ProjectV2?: ProjectV2Resolvers<ContextType>;
  ProjectV2Owner?: ProjectV2OwnerResolvers<ContextType>;
  ProjectV2Connection?: ProjectV2ConnectionResolvers<ContextType>;
  ProjectV2Edge?: ProjectV2EdgeResolvers<ContextType>;
  ProjectV2FieldCommon?: ProjectV2FieldCommonResolvers<ContextType>;
  ProjectV2Field?: ProjectV2FieldResolvers<ContextType>;
  ProjectV2SingleSelectField?: ProjectV2SingleSelectFieldResolvers<ContextType>;
  ProjectV2FieldConfiguration?: ProjectV2FieldConfigurationResolvers<ContextType>;
  ProjectV2FieldConfigurationConnection?: ProjectV2FieldConfigurationConnectionResolvers<ContextType>;
  ProjectV2FieldConfigurationEdge?: ProjectV2FieldConfigurationEdgeResolvers<ContextType>;
  ProjectV2SingleSelectFieldOption?: ProjectV2SingleSelectFieldOptionResolvers<ContextType>;
  ProjectV2Item?: ProjectV2ItemResolvers<ContextType>;
  ProjectV2ItemConnection?: ProjectV2ItemConnectionResolvers<ContextType>;
  ProjectV2ItemEdge?: ProjectV2ItemEdgeResolvers<ContextType>;
  ProjectV2ItemContent?: ProjectV2ItemContentResolvers<ContextType>;
  DraftIssue?: DraftIssueResolvers<ContextType>;
  ProjectV2ItemFieldValue?: ProjectV2ItemFieldValueResolvers<ContextType>;
  ProjectV2ItemFieldValueConnection?: ProjectV2ItemFieldValueConnectionResolvers<ContextType>;
  ProjectV2ItemFieldValueEdge?: ProjectV2ItemFieldValueEdgeResolvers<ContextType>;
  ProjectV2ItemFieldTextValue?: ProjectV2ItemFieldTextValueResolvers<ContextType>;
  ProjectV2ItemFieldNumberValue?: ProjectV2ItemFieldNumberValueResolvers<ContextType>;
  ProjectV2ItemFieldDateValue?: ProjectV2ItemFieldDateValueResolvers<ContextType>;
  ProjectV2ItemFieldSingleSelectValue?: ProjectV2ItemFieldSingleSelectValueResolvers<ContextType>;
  CreateProjectV2Payload?: CreateProjectV2PayloadResolvers<ContextType>;
  AddProjectV2ItemByIdPayload?: AddProjectV2ItemByIdPayloadResolvers<ContextType>;
  AddProjectV2DraftIssuePayload?: AddProjectV2DraftIssuePayloadResolvers<ContextType>;
  UpdateProjectV2DraftIssuePayload?: UpdateProjectV2DraftIssuePayloadResolvers<ContextType>;
  UpdateProjectV2ItemFieldValuePayload?: UpdateProjectV2ItemFieldValuePayloadResolvers<ContextType>;
  ClearProjectV2ItemFieldValuePayload?: ClearProjectV2ItemFieldValuePayloadResolvers<ContextType>;
  CreateProjectV2FieldPayload?: CreateProjectV2FieldPayloadResolvers<ContextType>;
  Date?: GraphQLScalarType;
  ProjectV2IterationField?: ProjectV2IterationFieldResolvers<ContextType>;
  ProjectV2ItemFieldIterationValue?: ProjectV2ItemFieldIterationValueResolvers<ContextType>;
  ProjectV2ItemFieldLabelValue?: ProjectV2ItemFieldLabelValueResolvers<ContextType>;
  ProjectV2ItemFieldMilestoneValue?: ProjectV2ItemFieldMilestoneValueResolvers<ContextType>;
  ProjectV2ItemFieldPullRequestValue?: ProjectV2ItemFieldPullRequestValueResolvers<ContextType>;
  ProjectV2ItemFieldRepositoryValue?: ProjectV2ItemFieldRepositoryValueResolvers<ContextType>;
  ProjectV2ItemFieldReviewerValue?: ProjectV2ItemFieldReviewerValueResolvers<ContextType>;
  ProjectV2ItemFieldUserValue?: ProjectV2ItemFieldUserValueResolvers<ContextType>;
  RequestedReviewerConnection?: RequestedReviewerConnectionResolvers<ContextType>;
  RequestedReviewerEdge?: RequestedReviewerEdgeResolvers<ContextType>;
  Discussion?: DiscussionResolvers<ContextType>;
  DiscussionCategory?: DiscussionCategoryResolvers<ContextType>;
  DiscussionComment?: DiscussionCommentResolvers<ContextType>;
  DiscussionConnection?: DiscussionConnectionResolvers<ContextType>;
  DiscussionEdge?: DiscussionEdgeResolvers<ContextType>;
  DiscussionCategoryConnection?: DiscussionCategoryConnectionResolvers<ContextType>;
  DiscussionCategoryEdge?: DiscussionCategoryEdgeResolvers<ContextType>;
  DiscussionCommentConnection?: DiscussionCommentConnectionResolvers<ContextType>;
  DiscussionCommentEdge?: DiscussionCommentEdgeResolvers<ContextType>;
  Votable?: VotableResolvers<ContextType>;
  CreateDiscussionPayload?: CreateDiscussionPayloadResolvers<ContextType>;
  AddDiscussionCommentPayload?: AddDiscussionCommentPayloadResolvers<ContextType>;
  MarkDiscussionCommentAsAnswerPayload?: MarkDiscussionCommentAsAnswerPayloadResolvers<ContextType>;
  UnmarkDiscussionCommentAsAnswerPayload?: UnmarkDiscussionCommentAsAnswerPayloadResolvers<ContextType>;
  AddUpvotePayload?: AddUpvotePayloadResolvers<ContextType>;
  RemoveUpvotePayload?: RemoveUpvotePayloadResolvers<ContextType>;
  CloseDiscussionPayload?: CloseDiscussionPayloadResolvers<ContextType>;
  ReopenDiscussionPayload?: ReopenDiscussionPayloadResolvers<ContextType>;
  UpdateDiscussionPayload?: UpdateDiscussionPayloadResolvers<ContextType>;
  DeleteDiscussionPayload?: DeleteDiscussionPayloadResolvers<ContextType>;
  UpdateDiscussionCommentPayload?: UpdateDiscussionCommentPayloadResolvers<ContextType>;
  DeleteDiscussionCommentPayload?: DeleteDiscussionCommentPayloadResolvers<ContextType>;
  Gist?: GistResolvers<ContextType>;
  GistFile?: GistFileResolvers<ContextType>;
  GistComment?: GistCommentResolvers<ContextType>;
  GistConnection?: GistConnectionResolvers<ContextType>;
  GistEdge?: GistEdgeResolvers<ContextType>;
  GistCommentConnection?: GistCommentConnectionResolvers<ContextType>;
  GistCommentEdge?: GistCommentEdgeResolvers<ContextType>;
  Language?: LanguageResolvers<ContextType>;
  StargazerConnection?: StargazerConnectionResolvers<ContextType>;
  StargazerEdge?: StargazerEdgeResolvers<ContextType>;
};

