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

/** A commit message entered through the web UI. Git itself allows more. */
export const MAX_COMMIT_MESSAGE_CHARS = 10_000;

/** An issue, pull request or comment body (GitHub's comment limit). */
export const MAX_BODY_CHARS = 65_536;

/** Bytes one web-UI file upload may decode to before it is committed. */
export const MAX_WEB_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Where the browser starts warning about an upload's size. Deliberately *below*
 * {@link MAX_WEB_UPLOAD_BYTES}: a warning that fires at the size the server
 * rejects is not a warning, it is the error message. `limits.test.ts` asserts
 * the ordering so the two cannot cross.
 */
export const UPLOAD_WARNING_BYTES = 10 * 1024 * 1024;

/**
 * Largest object `/api/raw` will serve. That endpoint streams from memory, so a
 * file reaching it is a file held in the function's heap; this is the git push
 * body cap, and an object larger than it can only exist by growing through
 * successive deltas. Above it the honest answer is `git clone` (see
 * `apps/docs/content/docs/internals/security.md`).
 */
export const MAX_RAW_BYTES = 50 * 1024 * 1024;

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

/** The largest JSON body a REST API (`/api/v3`) write request may send. */
export const MAX_API_BODY_BYTES = 1024 * 1024;

/** A label's name and description. */
export const MAX_LABEL_NAME_CHARS = 50;
export const MAX_LABEL_DESCRIPTION_CHARS = 100;

/** Labels one issue or pull request may carry. */
export const MAX_LABELS_PER_THREAD = 100;

/**
 * The longest supported issue/PR search query (`?q=`). GitHub caps a search
 * query at 256 characters, so a longer one is rejected rather than parsed into
 * an unbounded set of labels, authors and terms.
 */
export const MAX_SEARCH_QUERY_CHARS = 256;

/** GitHub's cap on assignees per issue. */
export const MAX_ASSIGNEES = 10;

/**
 * A review comment's diff path. A git path is far shorter than this in
 * practice; the bound exists so an unvalidated-looking path can't be persisted
 * as an unbounded string.
 */
export const MAX_REVIEW_PATH_CHARS = 4096;

/** An issue or pull request title (GitHub's limit). */
export const MAX_THREAD_TITLE_CHARS = 256;

/** A repository description. */
export const MAX_REPO_DESCRIPTION_CHARS = 500;

/** A personal access token's name. */
export const MAX_TOKEN_NAME_CHARS = 100;

/**
 * Comments or timeline events one thread read returns (GitHub's default page
 * is 30 too). The page is what the thread view loads at first and per "Load
 * more".
 */
export const THREAD_PAGE_SIZE = 30;

/**
 * The most items a thread read may ask for. Sized by the worst case rather than
 * the typical one: {@link MAX_BODY_CHARS} per comment times this must stay under
 * Vercel's 4.5 MB buffered-response cap (50 x 64 KiB = 3.2 MB), which is what
 * an unbounded read of a thread full of maximum-size comments broke.
 */
export const MAX_THREAD_PAGE_SIZE = 50;
