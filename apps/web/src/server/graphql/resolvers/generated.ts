import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { UserNode } from './core';
import type { RepositoryNode, RefNode } from './repository';
import type { CommitNode } from './commit';
import type { ReleaseNode, ReleaseAssetNode } from './releases';
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
};


/** The root query for implementing GraphQL mutations. */
export type MutationCreateRepositoryArgs = {
  input: CreateRepositoryInput;
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




/** Mapping of interface types */
export type ResolversInterfaceTypes<_RefType extends Record<string, unknown>> = {
  Node:
    | ( UserNode )
    | ( RepositoryNode )
    | ( RefNode )
    | ( CommitNode )
    | ( ReleaseNode )
    | ( ReleaseAssetNode )
  ;
  UniformResourceLocatable:
    | ( UserNode )
    | ( RepositoryNode )
    | ( ReleaseNode )
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
  __resolveType: TypeResolveFn<'User' | 'Repository' | 'Ref' | 'Commit' | 'Release' | 'ReleaseAsset', ParentType, ContextType>;
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
  __resolveType: TypeResolveFn<'User' | 'Repository' | 'Release', ParentType, ContextType>;
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
  latestRelease?: Resolver<Maybe<ResolversTypes['Release']>, ParentType, ContextType>;
  mergeCommitAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  mirrorUrl?: Resolver<Maybe<ResolversTypes['URI']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nameWithOwner?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  object?: Resolver<Maybe<ResolversTypes['GitObject']>, ParentType, ContextType, Partial<RepositoryObjectArgs>>;
  owner?: Resolver<ResolversTypes['RepositoryOwner'], ParentType, ContextType>;
  parent?: Resolver<Maybe<ResolversTypes['Repository']>, ParentType, ContextType>;
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
};

