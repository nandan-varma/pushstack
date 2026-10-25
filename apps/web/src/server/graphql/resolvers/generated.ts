import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { UserNode } from './core';
import type { RepositoryNode, RefNode } from './repository';
import type { CommitNode } from './commit';
import type { PullRequestNode } from './pulls';
import type { ReviewNode, CommentNode, RollupNode } from './pulls-detail';
import type { ReleaseNode, ReleaseAssetNode } from './releases';
import type { IssueTemplateNode } from './templates';
import type { RateLimitInfo, GraphQLContext } from '../context';
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
export type User = Actor & Node & RepositoryOwner & UniformResourceLocatable & {
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

/** The root query for implementing GraphQL mutations. */
export type Mutation = {
  __typename?: 'Mutation';
  /** Create a new repository. */
  createRepository?: Maybe<CreateRepositoryPayload>;
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
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreateRepositoryArgs = {
  input: CreateRepositoryInput;
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
  /** Returns a single pull request from the current repository by number. */
  pullRequest?: Maybe<PullRequest>;
  /** A list of pull requests that have been opened in the repository. */
  pullRequests: PullRequestConnection;
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
};


/** Represents a Git commit. */
export type CommitBlameArgs = {
  path: Scalars['String']['input'];
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
  /** Can read and clone this repository. Can also open and comment on issues and pull requests */
  | 'READ'
  /** Can read and clone this repository. Can also manage issues and pull requests */
  | 'TRIAGE'
  /** Can read and clone this repository. Can also manage issues and pull requests, plus additional triage abilities */
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
  /** The number of additions in this pull request. */
  additions: Scalars['Int']['output'];
  /** The number of deletions in this pull request. */
  deletions: Scalars['Int']['output'];
  /** A list of commits present in this pull request's head branch not present in the base branch. */
  commits: PullRequestCommitConnection;
  /** A list of review requests associated with the pull request. */
  reviewRequests?: Maybe<ReviewRequestConnection>;
  /** A list of reviews associated with the pull request. */
  reviews?: Maybe<PullRequestReviewConnection>;
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

/** A team of users in an organization. */
export type Team = {
  __typename?: 'Team';
  /** The organization that owns this team. */
  organization: Organization;
  /** The name of the team. */
  name: Scalars['String']['output'];
  /** The slug corresponding to the team. */
  slug: Scalars['String']['output'];
};

/** An account on GitHub, with one or more owners, that has repositories, members and teams. */
export type Organization = {
  __typename?: 'Organization';
  /** The organization's login name. */
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

/** Represents a Milestone object on a given repository. */
export type Milestone = {
  __typename?: 'Milestone';
  /** Identifies the number of the milestone. */
  number: Scalars['Int']['output'];
  /** Identifies the title of the milestone. */
  title: Scalars['String']['output'];
  /** Identifies the description of the milestone. */
  description?: Maybe<Scalars['String']['output']>;
  /** Identifies the due date of the milestone. */
  dueOn?: Maybe<Scalars['DateTime']['output']>;
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
  RequestedReviewer:
    | ( Bot )
    | ( Team )
    | ( UserNode )
  ;
  StatusCheckRollupContext:
    | ( CheckRun )
    | ( StatusContext )
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
    | ( PullRequestNode )
    | ( ReviewNode )
    | ( Label )
    | ( CommentNode )
  ;
  UniformResourceLocatable:
    | ( UserNode )
    | ( RepositoryNode )
    | ( ReleaseNode )
    | ( PullRequestNode )
  ;
  Actor: ( UserNode );
  RepositoryOwner: ( UserNode );
  RepositoryInfo: ( RepositoryNode );
  Starrable: ( RepositoryNode );
  GitObject: ( CommitNode );
};

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Node: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Node']>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  RateLimit: ResolverTypeWrapper<RateLimitInfo>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
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
  AutoMergeRequest: ResolverTypeWrapper<Omit<AutoMergeRequest, 'enabledBy'> & { enabledBy?: Maybe<ResolversTypes['Actor']> }>;
  PullRequestMergeMethod: PullRequestMergeMethod;
  MergeableState: MergeableState;
  PullRequestCommit: ResolverTypeWrapper<Omit<PullRequestCommit, 'commit'> & { commit: ResolversTypes['Commit'] }>;
  PullRequestCommitConnection: ResolverTypeWrapper<Omit<PullRequestCommitConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversTypes['PullRequestCommit']>>>, edges?: Maybe<Array<Maybe<ResolversTypes['PullRequestCommitEdge']>>> }>;
  PullRequestCommitEdge: ResolverTypeWrapper<Omit<PullRequestCommitEdge, 'node'> & { node?: Maybe<ResolversTypes['PullRequestCommit']> }>;
  ReviewRequest: ResolverTypeWrapper<Omit<ReviewRequest, 'requestedReviewer'> & { requestedReviewer?: Maybe<ResolversTypes['RequestedReviewer']> }>;
  RequestedReviewer: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['RequestedReviewer']>;
  ReviewRequestConnection: ResolverTypeWrapper<Omit<ReviewRequestConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversTypes['ReviewRequest']>>>, edges?: Maybe<Array<Maybe<ResolversTypes['ReviewRequestEdge']>>> }>;
  ReviewRequestEdge: ResolverTypeWrapper<Omit<ReviewRequestEdge, 'node'> & { node?: Maybe<ResolversTypes['ReviewRequest']> }>;
  Bot: ResolverTypeWrapper<Bot>;
  Team: ResolverTypeWrapper<Team>;
  Organization: ResolverTypeWrapper<Organization>;
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
  Milestone: ResolverTypeWrapper<Milestone>;
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
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Query: Record<PropertyKey, never>;
  ID: Scalars['ID']['output'];
  String: Scalars['String']['output'];
  Node: ResolversInterfaceTypes<ResolversParentTypes>['Node'];
  PageInfo: PageInfo;
  Boolean: Scalars['Boolean']['output'];
  RateLimit: RateLimitInfo;
  Int: Scalars['Int']['output'];
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
  GitObject: ResolversInterfaceTypes<ResolversParentTypes>['GitObject'];
  Commit: CommitNode;
  Blame: Omit<Blame, 'ranges'> & { ranges: Array<ResolversParentTypes['BlameRange']> };
  BlameRange: Omit<BlameRange, 'commit'> & { commit: ResolversParentTypes['Commit'] };
  GitObjectID: Scalars['GitObjectID']['output'];
  RepositoryOrder: RepositoryOrder;
  CreateRepositoryInput: CreateRepositoryInput;
  CreateRepositoryPayload: Omit<CreateRepositoryPayload, 'repository'> & { repository?: Maybe<ResolversParentTypes['Repository']> };
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
  AutoMergeRequest: Omit<AutoMergeRequest, 'enabledBy'> & { enabledBy?: Maybe<ResolversParentTypes['Actor']> };
  PullRequestCommit: Omit<PullRequestCommit, 'commit'> & { commit: ResolversParentTypes['Commit'] };
  PullRequestCommitConnection: Omit<PullRequestCommitConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestCommit']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestCommitEdge']>>> };
  PullRequestCommitEdge: Omit<PullRequestCommitEdge, 'node'> & { node?: Maybe<ResolversParentTypes['PullRequestCommit']> };
  ReviewRequest: Omit<ReviewRequest, 'requestedReviewer'> & { requestedReviewer?: Maybe<ResolversParentTypes['RequestedReviewer']> };
  RequestedReviewer: ResolversUnionTypes<ResolversParentTypes>['RequestedReviewer'];
  ReviewRequestConnection: Omit<ReviewRequestConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['ReviewRequest']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['ReviewRequestEdge']>>> };
  ReviewRequestEdge: Omit<ReviewRequestEdge, 'node'> & { node?: Maybe<ResolversParentTypes['ReviewRequest']> };
  Bot: Bot;
  Team: Team;
  Organization: Organization;
  PullRequestReview: ReviewNode;
  PullRequestReviewConnection: Omit<PullRequestReviewConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestReview']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['PullRequestReviewEdge']>>> };
  PullRequestReviewEdge: Omit<PullRequestReviewEdge, 'node'> & { node?: Maybe<ResolversParentTypes['PullRequestReview']> };
  UserConnection: Omit<UserConnection, 'nodes' | 'edges'> & { nodes?: Maybe<Array<Maybe<ResolversParentTypes['User']>>>, edges?: Maybe<Array<Maybe<ResolversParentTypes['UserEdge']>>> };
  UserEdge: Omit<UserEdge, 'node'> & { node?: Maybe<ResolversParentTypes['User']> };
  Label: Label;
  LabelConnection: LabelConnection;
  LabelEdge: LabelEdge;
  Milestone: Milestone;
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
};

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  viewer?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  node?: Resolver<Maybe<ResolversTypes['Node']>, ParentType, ContextType, RequireFields<QueryNodeArgs, 'id'>>;
  nodes?: Resolver<Array<Maybe<ResolversTypes['Node']>>, ParentType, ContextType, RequireFields<QueryNodesArgs, 'ids'>>;
  rateLimit?: Resolver<Maybe<ResolversTypes['RateLimit']>, ParentType, ContextType>;
  repository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType, RequireFields<QueryRepositoryArgs, 'name' | 'owner'>>;
  repositoryOwner?: Resolver<Maybe<ResolversTypes['RepositoryOwner']>, ParentType, ContextType, RequireFields<QueryRepositoryOwnerArgs, 'login'>>;
  user?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType, RequireFields<QueryUserArgs, 'login'>>;
};

export type NodeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Node'] = ResolversParentTypes['Node']> = {
  __resolveType: TypeResolveFn<'User' | 'Repository' | 'Ref' | 'Commit' | 'Release' | 'ReleaseAsset' | 'PullRequest' | 'PullRequestReview' | 'Label' | 'IssueComment', ParentType, ContextType>;
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
  __resolveType: TypeResolveFn<'User' | 'Repository' | 'Release' | 'PullRequest', ParentType, ContextType>;
};

export type ActorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Actor'] = ResolversParentTypes['Actor']> = {
  __resolveType: TypeResolveFn<'User', ParentType, ContextType>;
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
  createPullRequest?: Resolver<Maybe<ResolversTypes['CreatePullRequestPayload']>, ParentType, ContextType, RequireFields<MutationCreatePullRequestArgs, 'input'>>;
  markPullRequestReadyForReview?: Resolver<Maybe<ResolversTypes['MarkPullRequestReadyForReviewPayload']>, ParentType, ContextType, RequireFields<MutationMarkPullRequestReadyForReviewArgs, 'input'>>;
  convertPullRequestToDraft?: Resolver<Maybe<ResolversTypes['ConvertPullRequestToDraftPayload']>, ParentType, ContextType, RequireFields<MutationConvertPullRequestToDraftArgs, 'input'>>;
  closePullRequest?: Resolver<Maybe<ResolversTypes['ClosePullRequestPayload']>, ParentType, ContextType, RequireFields<MutationClosePullRequestArgs, 'input'>>;
  reopenPullRequest?: Resolver<Maybe<ResolversTypes['ReopenPullRequestPayload']>, ParentType, ContextType, RequireFields<MutationReopenPullRequestArgs, 'input'>>;
  updatePullRequest?: Resolver<Maybe<ResolversTypes['UpdatePullRequestPayload']>, ParentType, ContextType, RequireFields<MutationUpdatePullRequestArgs, 'input'>>;
};

export type RepositoryOwnerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RepositoryOwner'] = ResolversParentTypes['RepositoryOwner']> = {
  __resolveType: TypeResolveFn<'User', ParentType, ContextType>;
};

export type RepositoryInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RepositoryInfo'] = ResolversParentTypes['RepositoryInfo']> = {
  __resolveType: TypeResolveFn<'Repository', ParentType, ContextType>;
};

export type StarrableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Starrable'] = ResolversParentTypes['Starrable']> = {
  __resolveType: TypeResolveFn<'Repository', ParentType, ContextType>;
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
  pullRequest?: Resolver<Maybe<ResolversTypes['PullRequest']>, ParentType, ContextType, RequireFields<RepositoryPullRequestArgs, 'number'>>;
  pullRequests?: Resolver<ResolversTypes['PullRequestConnection'], ParentType, ContextType, Partial<RepositoryPullRequestsArgs>>;
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
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
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
  repository?: Resolver<ResolversTypes['Repository'], ParentType, ContextType>;
  resourcePath?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  url?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  blame?: Resolver<ResolversTypes['Blame'], ParentType, ContextType, RequireFields<CommitBlameArgs, 'path'>>;
  zipballUrl?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  tarballUrl?: Resolver<ResolversTypes['URI'], ParentType, ContextType>;
  statusCheckRollup?: Resolver<Maybe<ResolversTypes['StatusCheckRollup']>, ParentType, ContextType>;
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
  baseRefName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  headRepository?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
  headRepositoryOwner?: Resolver<Maybe<ResolversTypes['RepositoryOwner']>, ParentType, ContextType>;
  isCrossRepository?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  autoMergeRequest?: Resolver<Maybe<ResolversTypes['AutoMergeRequest']>, ParentType, ContextType>;
  maintainerCanModify?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  mergeable?: Resolver<ResolversTypes['MergeableState'], ParentType, ContextType>;
  additions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  deletions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  commits?: Resolver<ResolversTypes['PullRequestCommitConnection'], ParentType, ContextType, Partial<PullRequestCommitsArgs>>;
  reviewRequests?: Resolver<Maybe<ResolversTypes['ReviewRequestConnection']>, ParentType, ContextType, Partial<PullRequestReviewRequestsArgs>>;
  reviews?: Resolver<Maybe<ResolversTypes['PullRequestReviewConnection']>, ParentType, ContextType, Partial<PullRequestReviewsArgs>>;
  assignees?: Resolver<ResolversTypes['UserConnection'], ParentType, ContextType, Partial<PullRequestAssigneesArgs>>;
  labels?: Resolver<Maybe<ResolversTypes['LabelConnection']>, ParentType, ContextType, Partial<PullRequestLabelsArgs>>;
  milestone?: Resolver<Maybe<ResolversTypes['Milestone']>, ParentType, ContextType>;
  comments?: Resolver<ResolversTypes['IssueCommentConnection'], ParentType, ContextType, Partial<PullRequestCommentsArgs>>;
  reactionGroups?: Resolver<Maybe<Array<ResolversTypes['ReactionGroup']>>, ParentType, ContextType>;
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

export type TeamResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Team'] = ResolversParentTypes['Team']> = {
  organization?: Resolver<ResolversTypes['Organization'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type OrganizationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Organization'] = ResolversParentTypes['Organization']> = {
  login?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
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

export type MilestoneResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Milestone'] = ResolversParentTypes['Milestone']> = {
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  dueOn?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
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
  GitObject?: GitObjectResolvers<ContextType>;
  Commit?: CommitResolvers<ContextType>;
  Blame?: BlameResolvers<ContextType>;
  BlameRange?: BlameRangeResolvers<ContextType>;
  GitObjectID?: GraphQLScalarType;
  CreateRepositoryPayload?: CreateRepositoryPayloadResolvers<ContextType>;
  GitSSHRemote?: GraphQLScalarType;
  Release?: ReleaseResolvers<ContextType>;
  ReleaseAsset?: ReleaseAssetResolvers<ContextType>;
  ReleaseConnection?: ReleaseConnectionResolvers<ContextType>;
  ReleaseEdge?: ReleaseEdgeResolvers<ContextType>;
  ReleaseAssetConnection?: ReleaseAssetConnectionResolvers<ContextType>;
  ReleaseAssetEdge?: ReleaseAssetEdgeResolvers<ContextType>;
  IssueTemplate?: IssueTemplateResolvers<ContextType>;
  PullRequestTemplate?: PullRequestTemplateResolvers<ContextType>;
  PullRequest?: PullRequestResolvers<ContextType>;
  PullRequestConnection?: PullRequestConnectionResolvers<ContextType>;
  PullRequestEdge?: PullRequestEdgeResolvers<ContextType>;
  CreatePullRequestPayload?: CreatePullRequestPayloadResolvers<ContextType>;
  MarkPullRequestReadyForReviewPayload?: MarkPullRequestReadyForReviewPayloadResolvers<ContextType>;
  ConvertPullRequestToDraftPayload?: ConvertPullRequestToDraftPayloadResolvers<ContextType>;
  ClosePullRequestPayload?: ClosePullRequestPayloadResolvers<ContextType>;
  ReopenPullRequestPayload?: ReopenPullRequestPayloadResolvers<ContextType>;
  UpdatePullRequestPayload?: UpdatePullRequestPayloadResolvers<ContextType>;
  AutoMergeRequest?: AutoMergeRequestResolvers<ContextType>;
  PullRequestCommit?: PullRequestCommitResolvers<ContextType>;
  PullRequestCommitConnection?: PullRequestCommitConnectionResolvers<ContextType>;
  PullRequestCommitEdge?: PullRequestCommitEdgeResolvers<ContextType>;
  ReviewRequest?: ReviewRequestResolvers<ContextType>;
  RequestedReviewer?: RequestedReviewerResolvers<ContextType>;
  ReviewRequestConnection?: ReviewRequestConnectionResolvers<ContextType>;
  ReviewRequestEdge?: ReviewRequestEdgeResolvers<ContextType>;
  Bot?: BotResolvers<ContextType>;
  Team?: TeamResolvers<ContextType>;
  Organization?: OrganizationResolvers<ContextType>;
  PullRequestReview?: PullRequestReviewResolvers<ContextType>;
  PullRequestReviewConnection?: PullRequestReviewConnectionResolvers<ContextType>;
  PullRequestReviewEdge?: PullRequestReviewEdgeResolvers<ContextType>;
  UserConnection?: UserConnectionResolvers<ContextType>;
  UserEdge?: UserEdgeResolvers<ContextType>;
  Label?: LabelResolvers<ContextType>;
  LabelConnection?: LabelConnectionResolvers<ContextType>;
  LabelEdge?: LabelEdgeResolvers<ContextType>;
  Milestone?: MilestoneResolvers<ContextType>;
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
};

