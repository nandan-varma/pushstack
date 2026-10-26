/**
 * The maxima the write paths enforce.
 *
 * Each of these bounds something an authenticated caller controls that is
 * persisted — a git object, a Postgres row — or bounds how much history one
 * request may walk. They are not formatting preferences: without them the only
 * limit on a commit message, an issue body or a page offset is the platform's
 * request-body size, which is a much larger number than any of these and says
 * nothing about how much storage or CPU one request may consume.
 *
 * The upload bound is shared with the browser (`upload.tsx`), so what the UI
 * warns about and what the server accepts can't drift apart.
 */

export const MAX_COMMIT_MESSAGE_CHARS = 10_000;

export const MAX_BODY_CHARS = 65_536;

/** Bounds on what external CI reports (commit statuses, check runs); mirrors the API contract. */
export const MAX_STATUSES_PER_CONTEXT = 1000;
export const MAX_CHECK_RUNS_PER_COMMIT = 1000;

export const MAX_WEB_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Where the browser starts warning about an upload's size. Deliberately *below*
 * {@link MAX_WEB_UPLOAD_BYTES}: a warning that fires at the size the server
 * rejects is not a warning, it is the error message. `limits.test.ts` asserts
 * the ordering so the two cannot cross.
 */
export const UPLOAD_WARNING_BYTES = 10 * 1024 * 1024;

/**
 * Largest object the raw file route will serve. That endpoint streams from memory, so a
 * file reaching it is a file held in the function's heap; this is the git push
 * body cap, and an object larger than it can only exist by growing through
 * successive deltas. Above it the honest answer is `git clone` (see
 * `apps/docs/content/docs/internals/security.md`).
 */
export const MAX_RAW_BYTES = 50 * 1024 * 1024;

/**
 * Bounds of one source archive (zipball/tarball). The archive streams, so
 * these cap work, not memory: entries (files, symlinks and directories; also
 * keeps every zip offset in 32 bits) and the uncompressed bytes of all files.
 * Above them the answer is `git clone`.
 */
export const MAX_ARCHIVE_ENTRIES = 50_000;
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
/**
 * Release assets. A function request body is capped at 4.5 MB on Vercel, so
 * an upload through the API carries at most `MAX_RELEASE_ASSET_DIRECT_BYTES`;
 * anything larger goes straight to R2 on a presigned URL and is finalized
 * (verified against its declared size) afterwards, up to
 * `MAX_RELEASE_ASSET_BYTES`. GitHub's own limit is 2 GiB per asset.
 */
export const MAX_RELEASE_ASSET_DIRECT_BYTES = 4_000_000;
export const MAX_RELEASE_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
/**
 * The web form uploads files up to this size through a server function (as
 * base64: 4/3 larger, under Vercel's 4.5 MB body cap); bigger ones are PUT
 * to R2 on a presigned URL.
 */
export const MAX_RELEASE_ASSET_INLINE_BYTES = 3_000_000;
export const MAX_RELEASE_ASSETS = 1000;
/** Seconds a presigned upload URL stays valid. */
export const RELEASE_UPLOAD_URL_TTL_SECONDS = 900;
export const MAX_RELEASE_ASSET_NAME_CHARS = 255;
export const MAX_RELEASE_ASSET_LABEL_CHARS = 255;
export const MAX_RELEASE_NAME_CHARS = 256;
export const MAX_RELEASE_TAG_CHARS = 255;
/** Longest path (UTF-8 bytes) an archive entry may have. */
export const MAX_ARCHIVE_PATH_BYTES = 4096;

/**
 * Offset a list endpoint accepts. A commit page's walk depth is `limit + skip`,
 * so this is also the bound on how much history one request can be made to
 * traverse — deep enough for any pagination the UI offers, small enough that
 * the walk stays a bounded amount of work.
 */
export const MAX_LIST_SKIP = 10_000;

/**
 * The deepest history walk a validated list request can imply — the library
 * reads `limit + skip` commits for one page, so this is what
 * {@link MAX_LIST_SKIP} plus the largest `limit` comes to. Kept as a bound to
 * apply at the call into the git layer, so a future caller that bypassed the
 * input validation still can't ask for an unbounded walk.
 */
export const MAX_HISTORY_WALK = MAX_LIST_SKIP + 100;

/**
 * The most base64 characters that can decode to `byteLength` bytes — an exact
 * ceiling for validating an encoded payload before decoding it, so an oversized
 * upload is rejected without ever allocating the decoded bytes.
 */
export function maxBase64CharsForBytes(byteLength: number): number {
	return 4 * Math.ceil(byteLength / 3);
}

export const MAX_API_BODY_BYTES = 1024 * 1024;

/**
 * A diff or patch the REST API renders (commit, compare and pull request media
 * types). Below Vercel's 4.5 MB buffered-response cap with room for the framing,
 * so an oversized diff is a 406 and never a response the platform cuts off.
 * git-fs-s3's own budget (10 MiB of blob input) is larger on purpose: it bounds
 * the work, this bounds the bytes sent.
 */
export const MAX_API_DIFF_BYTES = 4_000_000;

export const MAX_LABEL_NAME_CHARS = 50;
export const MAX_LABEL_DESCRIPTION_CHARS = 100;

export const MAX_LABELS_PER_THREAD = 100;
/** The `query` of `Repository.labels`: a name or description search term. */
export const MAX_LABEL_SEARCH_CHARS = 100;
/**
 * Per-repository collections a writer can grow without limit otherwise: each
 * one is listed whole by some reader. Creating past a cap is a 422.
 */
export const MAX_LABELS_PER_REPOSITORY = 1000;
export const MAX_MILESTONES_PER_REPOSITORY = 1000;
export const MAX_RELEASES_PER_REPOSITORY = 1000;
export const MAX_COLLABORATORS_PER_REPOSITORY = 1000;

export const MAX_MILESTONE_TITLE_CHARS = 256;
export const MAX_MILESTONE_DESCRIPTION_CHARS = 65_536;

/**
 * The longest supported issue/PR search query (`?q=`). GitHub caps a search
 * query at 256 characters, so a longer one is rejected rather than parsed into
 * an unbounded set of labels, authors and terms.
 */
export const MAX_SEARCH_QUERY_CHARS = 256;

/** GitHub's cap on assignees per issue. */
export const MAX_ASSIGNEES = 10;

/** GitHub's cap on reviewers named in one request-reviewers call. */
export const MAX_REVIEWERS_PER_REQUEST = 15;

/** GitHub ignores a CODEOWNERS file over 3 MB; so do we. */
export const MAX_CODEOWNERS_BYTES = 3 * 1024 * 1024;

/**
 * A review comment's diff path. A git path is far shorter than this in
 * practice; the bound exists so an unvalidated-looking path can't be persisted
 * as an unbounded string.
 */
export const MAX_REVIEW_PATH_CHARS = 4096;

/** Review comments (line comments and replies) one pull request holds. */
export const MAX_REVIEW_COMMENTS_PER_PULL_REQUEST = 2000;

export const MAX_THREAD_TITLE_CHARS = 256;

/** A template query parameter names one file in ISSUE_TEMPLATE. */
export const MAX_TEMPLATE_FILENAME_CHARS = 255;
/** Bounds on default-branch issue and pull request template discovery. */
export const MAX_TEMPLATE_FILES = 50;
export const MAX_TEMPLATE_FILE_BYTES = 65_536;
export const MAX_TEMPLATE_TOTAL_BYTES = 256_000;

export const MAX_REPO_DESCRIPTION_CHARS = 500;
export const MAX_REPO_HOMEPAGE_CHARS = 255;
export const MAX_REPO_TOPICS = 20;
export const MAX_REPO_TOPIC_CHARS = 50;

/**
 * Bytes a fork may copy. A fork copies its parent's git prefix server-side in
 * one synchronous request (no background workers), so the copy's time and R2
 * cost grow with the source. Larger sources are refused with 422 until a
 * multipart copy exists; R2's single `CopyObject` tops out at 5 GiB.
 */
export const MAX_FORK_COPY_BYTES = 1024 ** 3;

export const MAX_TOKEN_NAME_CHARS = 100;

/** Device flow (`/login/device/code`): the client id a device code is bound to. */
export const MAX_DEVICE_CLIENT_ID_CHARS = 100;
/** Device flow: a user code typed on the approval page, before normalizing. */
export const MAX_DEVICE_USER_CODE_CHARS = 64;
/** Device flow: a form or JSON body on the device endpoints (a few short fields). */
export const MAX_DEVICE_REQUEST_BYTES = 8 * 1024;
/** OAuth apps (/settings/developers): the name a user gives an app. */
export const MAX_OAUTH_APP_NAME_CHARS = 100;
/** OAuth apps: registrations one user may hold at once. */
export const MAX_OAUTH_APPS_PER_USER = 100;
/** OAuth authorization: the `scope` a client asks for (GitHub scope names). */
export const MAX_OAUTH_SCOPE_CHARS = 1000;
/** OAuth apps: the registered redirect URI (also the longest one accepted). */
export const MAX_OAUTH_CALLBACK_URL_CHARS = 2048;
/** OAuth authorization: the `state` a client sends, echoed back unchanged. */
export const MAX_OAUTH_STATE_CHARS = 1000;
/** OAuth token exchange: the client id and secret a client presents. */
export const MAX_OAUTH_CLIENT_ID_CHARS = 100;
export const MAX_OAUTH_CLIENT_SECRET_CHARS = 100;
/** OAuth token exchange: the authorization code a client presents. */
export const MAX_OAUTH_CODE_CHARS = 100;

/**
 * What one function response may carry: Vercel's buffered-response cap is
 * 4.5 MB; this leaves headroom for the rest of the payload and the framing.
 */
const RESPONSE_BUDGET_BYTES = 4_000_000;

/**
 * Serialized bytes a maximum-length comment can take, worst case. A body is
 * counted in characters ({@link MAX_BODY_CHARS}), but JSON spends up to 6 bytes
 * on one (a control character as `\u00XX`) and UTF-8 up to 3 on a CJK one, so
 * the bound is `MAX_BODY_CHARS * 6`, not `* 1`. The 1,000 is a generous
 * allowance for the author, timestamps and keys of the row around the body.
 */
const MAX_COMMENT_RESPONSE_BYTES = MAX_BODY_CHARS * 6 + 1_000;

/**
 * The most items a thread read (comments or timeline events) may ask for:
 * `floor(4,000,000 / (65,536 * 6 + 1,000))` = 10 comments of 394,216 bytes
 * each, so a page of worst-case comments stays under the 4.5 MB cap that an
 * unbounded read of such a thread broke. `limits.test.ts` serializes one.
 */
export const MAX_THREAD_PAGE_SIZE = Math.floor(
	RESPONSE_BUDGET_BYTES / MAX_COMMENT_RESPONSE_BYTES,
);

/** Items one thread read returns when it doesn't say; also the UI's page. */
export const THREAD_PAGE_SIZE = MAX_THREAD_PAGE_SIZE;
